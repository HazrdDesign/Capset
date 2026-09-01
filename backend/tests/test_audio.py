"""Tests for the dependency-free audio reader.

Real files are generated and read back, so these exercise actual byte
layouts rather than mocks. AIFF fixtures are written with the stdlib `aifc`
module — used only to CREATE test data; the reader itself does not depend on
it, because aifc was removed in Python 3.13.
"""

import struct
import wave

import numpy as np
import pytest

from app.audio import AudioError, load_audio, slice_audio


def write_wav(path, samples, rate=48000, channels=1, width=2):
    """samples: float [-1, 1], interleaved if multi-channel."""
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        if width == 1:
            raw = ((np.asarray(samples) * 128.0) + 128.0).astype(np.uint8).tobytes()
        elif width == 2:
            raw = (np.asarray(samples) * 32767.0).astype("<i2").tobytes()
        elif width == 4:
            raw = (np.asarray(samples) * (2 ** 31 - 1)).astype("<i4").tobytes()
        else:
            raise ValueError(width)
        handle.writeframes(raw)
    return path


def tone(seconds=0.5, rate=48000, freq=440.0):
    t = np.linspace(0, seconds, int(seconds * rate), endpoint=False)
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


# --- WAV ------------------------------------------------------------------

def test_reads_16bit_mono_wav(tmp_path):
    expected = tone()
    audio, rate = load_audio(write_wav(tmp_path / "a.wav", expected))
    assert rate == 48000
    assert audio.dtype == np.float32
    assert len(audio) == len(expected)
    assert np.allclose(audio, expected, atol=1e-3)


def test_preserves_the_native_sample_rate(tmp_path):
    """No resampling here — onnx-asr does it, and needs the true rate."""
    for rate in (8000, 16000, 22050, 44100, 48000):
        _, read_rate = load_audio(write_wav(tmp_path / f"{rate}.wav", tone(0.1, rate), rate=rate))
        assert read_rate == rate


def test_stereo_is_downmixed_to_mono(tmp_path):
    left = np.full(1000, 0.5, dtype=np.float32)
    right = np.full(1000, -0.1, dtype=np.float32)
    interleaved = np.empty(2000, dtype=np.float32)
    interleaved[0::2] = left
    interleaved[1::2] = right

    audio, _ = load_audio(write_wav(tmp_path / "s.wav", interleaved, channels=2))
    assert len(audio) == 1000, "one sample per frame, not per channel"
    assert np.allclose(audio, 0.2, atol=1e-3), "should be the channel mean"


def test_reads_8bit_wav(tmp_path):
    """8-bit PCM is UNSIGNED and centred on 128, unlike every wider format."""
    audio, _ = load_audio(write_wav(tmp_path / "8.wav", tone(0.1), width=1))
    assert audio.dtype == np.float32
    assert np.abs(audio).max() < 1.01
    assert np.abs(audio).max() > 0.1, "signal should survive, not flatten"


def test_reads_32bit_wav(tmp_path):
    expected = tone(0.1)
    audio, _ = load_audio(write_wav(tmp_path / "32.wav", expected, width=4))
    assert np.allclose(audio, expected, atol=1e-3)


def test_samples_stay_in_range(tmp_path):
    loud = np.full(500, 0.999, dtype=np.float32)
    audio, _ = load_audio(write_wav(tmp_path / "loud.wav", loud))
    assert np.abs(audio).max() <= 1.0 + 1e-6


# --- AIFF -----------------------------------------------------------------

def write_aiff(path, samples, rate=48000, channels=1, width=2):
    aifc = pytest.importorskip("aifc", reason="aifc removed in Python 3.13")
    with aifc.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        handle.setcomptype(b"NONE", b"not compressed")
        handle.writeframes((np.asarray(samples) * 32767.0).astype(">i2").tobytes())
    return path


def test_reads_big_endian_aiff(tmp_path):
    """AE renders AIFF on some hosts; AIFF is big-endian, WAV is little."""
    expected = tone(0.2)
    audio, rate = load_audio(write_aiff(tmp_path / "a.aiff", expected))
    assert rate == 48000
    assert len(audio) == len(expected)
    assert np.allclose(audio, expected, atol=1e-3), "byte order likely not swapped"


def test_aiff_sample_rate_decodes_from_80bit_float(tmp_path):
    """AIFF stores the rate as an 80-bit IEEE extended float."""
    for rate in (44100, 48000):
        _, read_rate = load_audio(write_aiff(tmp_path / f"{rate}.aiff", tone(0.05, rate), rate=rate))
        assert read_rate == rate


def test_aiff_stereo_is_downmixed(tmp_path):
    interleaved = np.empty(1000, dtype=np.float32)
    interleaved[0::2] = 0.4
    interleaved[1::2] = 0.0
    audio, _ = load_audio(write_aiff(tmp_path / "st.aiff", interleaved, channels=2))
    assert len(audio) == 500
    assert np.allclose(audio, 0.2, atol=1e-3)


# --- format detection and errors -----------------------------------------

def test_content_is_trusted_over_extension(tmp_path):
    """AE's output naming is not always predictable."""
    path = write_wav(tmp_path / "mislabelled.aiff", tone(0.1))
    audio, rate = load_audio(path)
    assert rate == 48000 and len(audio) > 0


def test_missing_file_raises_clearly(tmp_path):
    with pytest.raises(AudioError, match="not found"):
        load_audio(tmp_path / "nope.wav")


def test_unknown_format_raises_clearly(tmp_path):
    path = tmp_path / "x.mp3"
    path.write_bytes(b"\xff\xfb" + b"\x00" * 64)
    with pytest.raises(AudioError, match="unsupported audio format"):
        load_audio(path)


def test_compressed_aiff_is_rejected_with_a_useful_message(tmp_path):
    """Better than decoding garbage into silent, wrong captions."""
    comm = struct.pack(">HIH", 1, 10, 16) + b"\x40\x0e\xbb\x80\x00\x00\x00\x00\x00\x00" + b"ulaw"
    body = b"AIFC" + b"COMM" + struct.pack(">I", len(comm)) + comm
    path = tmp_path / "c.aiff"
    path.write_bytes(b"FORM" + struct.pack(">I", len(body)) + body)
    with pytest.raises(AudioError, match="compressed"):
        load_audio(path)


# --- slicing --------------------------------------------------------------

def test_slice_extracts_the_requested_window():
    audio = np.arange(48000, dtype=np.float32)
    assert len(slice_audio(audio, 0.0, 0.5, 48000)) == 24000


def test_slice_clamps_past_the_end():
    audio = np.arange(1000, dtype=np.float32)
    assert len(slice_audio(audio, 0.0, 99.0, 48000)) == 1000


def test_slice_of_an_inverted_range_is_empty():
    audio = np.arange(1000, dtype=np.float32)
    assert len(slice_audio(audio, 0.5, 0.1, 48000)) == 0
