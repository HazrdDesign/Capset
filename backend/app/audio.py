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
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Mirrors onnx_asr.utils.SampleRates. Not imported directly: audio.py has no
# other dependency on the ASR engine, and this is a fixed, versioned contract
# in a third-party library, not something worth coupling an import to.
_ASR_SUPPORTED_RATES = frozenset({8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000})
_ASR_FALLBACK_RATE = 16_000

# Samples per block in measure(). A million float32 samples is 4 MB, twice
# that once widened -- small enough to stay in cache, large enough that the
# per-block overhead disappears.
_MEASURE_BLOCK = 1 << 20

# Above this, _resample refuses rather than trying. The Fourier method needs
# the whole signal at once; at 20 minutes of 48 kHz this is already ~1 GB of
# transient complex128, and it grows linearly from there.
_RESAMPLE_MAX_SAMPLES = 60 * 60 * 16_000


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
    # rfft promotes to float64 and returns complex128, so this peaks at
    # several times the input's size: an hour of 48 kHz would need gigabytes
    # to produce one resampled array. Every rate After Effects actually
    # renders at is on the whitelist above, so this runs only on the odd ones
    # (a 47999 Hz project has been seen), and those are worth refusing rather
    # than dying inside numpy with no explanation.
    if samples.size > _RESAMPLE_MAX_SAMPLES:
        raise AudioError(
            "that audio is %.0f minutes at %d Hz, and %d Hz is a rate the "
            "speech engine cannot take directly. Resampling it needs more "
            "memory than this is willing to use. Render at 48 kHz (Output "
            "Module > Audio) and try again."
            % (samples.size / orig_rate / 60, orig_rate, orig_rate)
        )
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


@dataclass(frozen=True)
class SourceFormat:
    """What the file on disk actually was, before anything was done to it.

    Reported because the rate the model ran at is the WRONG number to show a
    user chasing an empty transcript: it is always one of a handful of
    whitelisted values, so it looks reasonable even when the file was
    nonsense. v0.2.4 logged "16000 Hz" for a 48 kHz render whose header had
    been destroyed in transit, and the one number that would have given it
    away -- the rate read off the file -- was never printed.
    """

    container: str
    channels: int
    bits: int
    sample_rate: int
    resampled_to: int | None = None

    def describe(self) -> str:
        text = "%s, %dch, %d-bit, %d Hz" % (
            self.container, self.channels, self.bits, self.sample_rate
        )
        if self.resampled_to:
            text += " (resampled to %d Hz)" % self.resampled_to
        return text


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


def _read_wav(path: Path) -> tuple[np.ndarray, int, SourceFormat]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    if not raw:
        raise AudioError("the rendered WAV contains no audio")
    fmt = SourceFormat("WAV", channels, width * 8, rate)
    return _pcm_to_float32(raw, width, channels), rate, fmt


def _read_aiff(path: Path) -> tuple[np.ndarray, int, SourceFormat]:
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
            # round(), not int(). The rate is an 80-bit extended float, and a
            # writer whose 48000 decodes to 47999.9999 would truncate to
            # 47999 -- off the ASR whitelist, forcing a needless resample of a
            # perfectly good 48 kHz file.
            rate = int(round(_extended_to_float(body[8:18])))
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

    container = "AIFF-C" if data[8:12] == b"AIFC" else "AIFF"
    fmt = SourceFormat(container, channels, width * 8, rate)
    return _pcm_to_float32(samples, width, channels), rate, fmt


def _extended_to_float(raw: bytes) -> float:
    """Decode an 80-bit IEEE extended float — how AIFF stores its sample rate."""
    exponent = struct.unpack(">H", raw[0:2])[0]
    (mantissa,) = struct.unpack(">Q", raw[2:10])
    sign = -1 if exponent & 0x8000 else 1
    exponent &= 0x7FFF
    if exponent == 0 and mantissa == 0:
        return 0.0
    return sign * mantissa * (2.0 ** (exponent - 16383 - 63))


def read_with_format(path: str | Path) -> tuple[np.ndarray, int, SourceFormat]:
    """Read rendered audio, and say what the file actually was.

    Returns (mono float32 samples, sample rate, source format). The returned
    rate is always one onnx-asr's numpy-array input accepts -- see
    _ASR_SUPPORTED_RATES above -- which is exactly why the third value
    matters: it is the only record of what was on disk.
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
        samples, rate, fmt = _read_wav(path)
    elif header[0:4] == b"FORM":
        samples, rate, fmt = _read_aiff(path)
    else:
        # Unrecognised magic: fall back to the extension before giving up.
        suffix = path.suffix.lower()
        if suffix in (".wav", ".wave"):
            samples, rate, fmt = _read_wav(path)
        elif suffix in (".aif", ".aiff", ".aifc"):
            samples, rate, fmt = _read_aiff(path)
        else:
            raise AudioError(
                f"unsupported audio format: {path.suffix or 'unknown'}. Capset "
                "reads the uncompressed WAV or AIFF that After Effects renders."
            )

    if rate not in _ASR_SUPPORTED_RATES:
        samples = _resample(samples, rate, _ASR_FALLBACK_RATE)
        rate = _ASR_FALLBACK_RATE
        fmt = SourceFormat(fmt.container, fmt.channels, fmt.bits,
                           fmt.sample_rate, resampled_to=rate)
    return samples, rate, fmt


def load_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Read rendered audio. Returns (mono float32 samples, sample rate)."""
    samples, rate, _ = read_with_format(path)
    return samples, rate


# Peak below this is not quiet dialogue, it is a file with nothing in it.
# A 16-bit sample's smallest step is 1/32768 (~3.1e-5), so dither-only noise
# from a silent render still peaks around there; 1e-5 sits below even that and
# above exact zero, which is what a truly silent render usually contains.
SILENT_PEAK = 1e-5

# Peak below this (-60 dBFS) is real signal but far too quiet to recognise.
# Not an error on its own -- it is reported so that zero words comes with its
# most likely explanation attached instead of looking like a model failure.
QUIET_PEAK = 1e-3


def measure(audio: np.ndarray) -> tuple[float, float]:
    """Peak and RMS amplitude, both 0..1.

    Exists because "the transcription found no speech" and "the file we were
    handed contains no audio" are indistinguishable to the user otherwise, and
    they call for completely different actions. Shipped after a real run
    rendered a silent WAV out of After Effects and reported a successful
    transcription of zero words.

    Computed a block at a time rather than over the whole array. The obvious
    spelling -- audio.astype(np.float64), then abs, then ** 2 -- allocates
    roughly four times the audio's own size in temporaries, and the audio here
    is not small: an hour of 48 kHz mono is 691 MB of float32, so that is
    ~2.8 GB of transient allocation to produce two scalars. This allocates
    essentially nothing -- 0.1 MB against 16.8 MB for a 16.8 MB buffer -- and
    runs about 2.6x faster, to the same answer. The sum accumulates in float64
    so a long file does not lose precision the way a float32 running total
    would.
    """
    if audio.size == 0:
        return 0.0, 0.0

    peak = 0.0
    total = 0.0
    for start in range(0, audio.size, _MEASURE_BLOCK):
        block = audio[start:start + _MEASURE_BLOCK]
        # max(-min, max) is the largest absolute value and allocates nothing;
        # np.abs(block).max() would build a whole second block to find it.
        block_peak = max(-float(block.min()), float(block.max()))
        if block_peak > peak:
            peak = block_peak
        # einsum sums the squares with a float64 accumulator without widening
        # the block first, which astype() or ** 2 would.
        total += float(np.einsum("i,i->", block, block, dtype=np.float64))
    return peak, float(np.sqrt(total / audio.size))


def describe_level(peak: float) -> str:
    """Peak as dBFS, for a message a user can act on."""
    if peak <= 0:
        return "digital silence"
    return "%.1f dBFS peak" % (20.0 * np.log10(peak))


def slice_audio(audio: np.ndarray, start_s: float, end_s: float,
                sample_rate: int) -> np.ndarray:
    """Extract [start_s, end_s) as samples, clamped to the array."""
    start = max(0, int(round(start_s * sample_rate)))
    end = min(len(audio), int(round(end_s * sample_rate)))
    if end <= start:
        return np.zeros(0, dtype=np.float32)
    return audio[start:end]
