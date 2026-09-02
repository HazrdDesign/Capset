"""Reading rendered audio. No ffmpeg, no external decoder.

After Effects renders the audio for us, which is both simpler and more
correct than decoding the source file: we get what the user actually hears —
the comp mix, levels, mute states, audio effects, time remapping, nested
comps — rather than whatever happens to be inside one footage file.

AE writes uncompressed PCM, as WAV or AIFF depending on which output module
template the host offers (WAV on Windows, AIFF is common on macOS). Both are
simple IFF-style containers, so they are parsed here directly. That removes
the ~100 MB ffmpeg bundle and its LGPL obligations entirely.

Resampling is mostly not done here -- onnx-asr takes a sample rate alongside
the samples and does its own internal resampling. But that only covers a
fixed whitelist of rates (onnx_asr.utils.SampleRates: 8000/11025/16000/22050/
24000/32000/44100/48000); anything else raises WrongSampleRateError instead
of resampling, and After Effects projects are routinely set to rates outside
that list (96 kHz is a common "high quality" project setting). So a native
rate outside the whitelist is resampled here, to 16 kHz -- the rate Parakeet
actually runs at internally regardless of what it's given, so landing there
directly loses nothing further downstream.
"""

from __future__ import annotations

import struct
import wave
from pathlib import Path

import numpy as np

# Mirrors onnx_asr.utils.SampleRates. Not imported directly: audio.py has no
# other dependency on the ASR engine, and this is a fixed, versioned contract
# in a third-party library, not something worth coupling an import to.
_ASR_SUPPORTED_RATES = frozenset({8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000})
_ASR_FALLBACK_RATE = 16_000


def _resample(samples: np.ndarray, orig_rate: int, target_rate: int) -> np.ndarray:
    """Bandlimited resample via the Fourier method -- no scipy dependency.

    Truncating (downsampling) or zero-padding (upsampling) the spectrum
    before inverting it is the same technique scipy.signal.resample uses;
    unlike naive linear interpolation it does not alias when downsampling
    from a much higher rate (e.g. a 96 kHz project render).
    """
    if orig_rate == target_rate or samples.size == 0:
        return samples
    target_len = max(1, round(samples.size * target_rate / orig_rate))
    spectrum = np.fft.rfft(samples)
    keep = target_len // 2 + 1
    if keep <= spectrum.size:
        spectrum = spectrum[:keep]
    else:
        spectrum = np.pad(spectrum, (0, keep - spectrum.size))
    resampled = np.fft.irfft(spectrum, n=target_len) * (target_len / samples.size)
    return resampled.astype(np.float32)


class AudioError(RuntimeError):
    pass


def _pcm_to_float32(raw: bytes, sample_width: int, channels: int) -> np.ndarray:
    """Interleaved integer PCM -> mono float32 in [-1, 1]."""
    if sample_width == 1:
        # 8-bit PCM is unsigned, centred on 128 — unlike every wider format.
        samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 3:
        # 24-bit has no numpy dtype: widen each 3-byte group to 4 bytes,
        # sign-extending via the high byte.
        as_bytes = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        widened = np.zeros((as_bytes.shape[0], 4), dtype=np.uint8)
        widened[:, 1:] = as_bytes
        samples = widened.view("<i4").flatten().astype(np.float32) / (2 ** 31)
    elif sample_width == 4:
        samples = np.frombuffer(raw, dtype="<i4").astype(np.float32) / (2 ** 31)
    else:
        raise AudioError(f"unsupported sample width: {sample_width * 8}-bit")

    if channels > 1:
        usable = (len(samples) // channels) * channels
        samples = samples[:usable].reshape(-1, channels).mean(axis=1)
    return np.ascontiguousarray(samples, dtype=np.float32)


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    if not raw:
        raise AudioError("the rendered WAV contains no audio")
    return _pcm_to_float32(raw, width, channels), rate


def _read_aiff(path: Path) -> tuple[np.ndarray, int]:
    """Minimal AIFF/AIFF-C reader.

    Deliberately not the stdlib `aifc`: it is deprecated and was removed in
    Python 3.13, so depending on it would break the moment the build moves to
    a newer interpreter. The format is simple enough to read directly.
    """
    data = path.read_bytes()
    if len(data) < 12 or data[0:4] != b"FORM" or data[8:12] not in (b"AIFF", b"AIFC"):
        raise AudioError("not a valid AIFF file")

    channels = width = rate = None
    samples = None
    offset = 12
    while offset + 8 <= len(data):
        chunk_id = data[offset:offset + 4]
        (size,) = struct.unpack(">I", data[offset + 4:offset + 8])
        body = data[offset + 8:offset + 8 + size]

        if chunk_id == b"COMM" and len(body) >= 18:
            channels, _frames, bits = struct.unpack(">HIH", body[0:8])
            width = bits // 8
            rate = int(_extended_to_float(body[8:18]))
            if len(body) > 18 and body[18:22] not in (b"NONE", b"sowt", b"twos"):
                raise AudioError(
                    f"compressed AIFF ({body[18:22].decode('ascii', 'replace')}) "
                    "is not supported — render uncompressed audio"
                )
            byteswapped = len(body) > 18 and body[18:22] == b"sowt"
        elif chunk_id == b"SSND" and len(body) >= 8:
            (data_offset,) = struct.unpack(">I", body[0:4])
            samples = body[8 + data_offset:]

        # Chunks are word-aligned: an odd size is followed by a pad byte.
        offset += 8 + size + (size % 2)

    if channels is None or samples is None:
        raise AudioError("AIFF file is missing its COMM or SSND chunk")
    if not samples:
        raise AudioError("the rendered AIFF contains no audio")

    # AIFF is big-endian; 'sowt' marks little-endian AIFF-C. _pcm_to_float32
    # reads little-endian, so byte-swap unless already little-endian.
    if width in (2, 4) and not locals().get("byteswapped", False):
        arr = np.frombuffer(samples, dtype=f">i{width}").astype(
            "<i4" if width == 4 else "<i2"
        )
        samples = arr.tobytes()
    elif width == 3 and not locals().get("byteswapped", False):
        triples = np.frombuffer(
            samples[: (len(samples) // 3) * 3], dtype=np.uint8
        ).reshape(-1, 3)
        samples = triples[:, ::-1].tobytes()

    return _pcm_to_float32(samples, width, channels), rate


def _extended_to_float(raw: bytes) -> float:
    """Decode an 80-bit IEEE extended float — how AIFF stores its sample rate."""
    exponent = struct.unpack(">H", raw[0:2])[0]
    (mantissa,) = struct.unpack(">Q", raw[2:10])
    sign = -1 if exponent & 0x8000 else 1
    exponent &= 0x7FFF
    if exponent == 0 and mantissa == 0:
        return 0.0
    return sign * mantissa * (2.0 ** (exponent - 16383 - 63))


def load_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Read rendered audio. Returns (mono float32 samples, sample rate).

    The returned rate is always one onnx-asr's numpy-array input accepts --
    see _ASR_SUPPORTED_RATES above.
    """
    path = Path(path)
    if not path.exists():
        raise AudioError(f"audio file not found: {path}")

    # Sniff the magic bytes FIRST. After Effects' output naming is not always
    # predictable, and a WAV written with an .aiff extension must still read
    # correctly — dispatching on the extension would send it to the wrong
    # parser and fail on a file that is perfectly valid.
    with open(path, "rb") as handle:
        header = handle.read(12)
    if header[0:4] == b"RIFF":
        samples, rate = _read_wav(path)
    elif header[0:4] == b"FORM":
        samples, rate = _read_aiff(path)
    else:
        # Unrecognised magic: fall back to the extension before giving up.
        suffix = path.suffix.lower()
        if suffix in (".wav", ".wave"):
            samples, rate = _read_wav(path)
        elif suffix in (".aif", ".aiff", ".aifc"):
            samples, rate = _read_aiff(path)
        else:
            raise AudioError(
                f"unsupported audio format: {path.suffix or 'unknown'}. Capset "
                "reads the uncompressed WAV or AIFF that After Effects renders."
            )

    if rate not in _ASR_SUPPORTED_RATES:
        samples = _resample(samples, rate, _ASR_FALLBACK_RATE)
        rate = _ASR_FALLBACK_RATE
    return samples, rate


def slice_audio(audio: np.ndarray, start_s: float, end_s: float,
                sample_rate: int) -> np.ndarray:
    """Extract [start_s, end_s) as samples, clamped to the array."""
    start = max(0, int(round(start_s * sample_rate)))
    end = min(len(audio), int(round(end_s * sample_rate)))
    if end <= start:
        return np.zeros(0, dtype=np.float32)
    return audio[start:end]
