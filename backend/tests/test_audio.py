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

from app.audio import (
    AudioError,
    _resample,
    describe_level,
    load_audio,
    measure,
    slice_audio,
)


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


def test_preserves_rates_onnx_asr_already_accepts(tmp_path):
    """onnx-asr resamples these itself — converting again would be lossy for no benefit."""
    for rate in (8000, 16000, 22050, 44100, 48000):
        _, read_rate = load_audio(write_wav(tmp_path / f"{rate}.wav", tone(0.1, rate), rate=rate))
        assert read_rate == rate


def test_unsupported_rate_is_resampled_to_16k(tmp_path):
    """96 kHz is a routine After Effects project setting, and onnx-asr's
    numpy-array input raises WrongSampleRateError for anything outside its
    fixed whitelist -- it does not resample arbitrary rates the way it does
    for a file path input. This is the exact bug reported from a real
    After Effects render."""
    seconds = 0.2
    audio, rate = load_audio(write_wav(tmp_path / "96k.wav", tone(seconds, 96000, freq=440.0), rate=96000))
    assert rate == 16000
    assert abs(len(audio) - int(seconds * 16000)) <= 1


def test_resampling_below_16k_upsamples_to_it(tmp_path):
    """A rate below the whitelist's floor (8000) should also land on 16 kHz,
    not merely on the nearest supported rate."""
    seconds = 0.2
    audio, rate = load_audio(write_wav(tmp_path / "6k.wav", tone(seconds, 6000, freq=200.0), rate=6000))
    assert rate == 16000
    assert abs(len(audio) - int(seconds * 16000)) <= 1


def test_resampling_preserves_tone_frequency(tmp_path):
    """Not just the right length -- the resampled signal should still be
    recognisably the same tone, i.e. actually bandlimited rather than
    aliased noise."""
    seconds = 0.5
    freq = 440.0
    audio, rate = load_audio(write_wav(tmp_path / "hi.wav", tone(seconds, 96000, freq=freq), rate=96000))

    spectrum = np.abs(np.fft.rfft(audio))
    freqs = np.fft.rfftfreq(len(audio), d=1.0 / rate)
    peak_freq = freqs[np.argmax(spectrum)]
    assert abs(peak_freq - freq) < 5.0


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


def _aiff_bytes(rate_ext: bytes, frames: int = 480, channels: int = 1) -> bytes:
    """A hand-built AIFF, so the sample rate's 80-bit encoding can be chosen.

    `aifc` only ever writes an exact integer rate, which is precisely the case
    that cannot expose a truncation bug.
    """
    comm = struct.pack(">HIH", channels, frames, 16) + rate_ext
    pcm = np.zeros(frames * channels, dtype=">i2")
    pcm[::2] = 8000
    ssnd = struct.pack(">II", 0, 0) + pcm.tobytes()
    body = (b"AIFF"
            + b"COMM" + struct.pack(">I", len(comm)) + comm
            + b"SSND" + struct.pack(">I", len(ssnd)) + ssnd)
    return b"FORM" + struct.pack(">I", len(body)) + body


def test_aiff_rate_just_under_an_integer_is_rounded_not_truncated(tmp_path):
    """48000 stored as 47999.9999 must still read as 48000.

    Truncating gives 47999, which is not on onnx-asr's whitelist, so a
    perfectly good 48 kHz render would be resampled for nothing -- losing
    quality and time to a rounding error in the last bit of an 80-bit float.
    """
    # 47999.9999, encoded the way AIFF stores it.
    ext = bytes.fromhex("400ebb7ffff972474800")
    path = tmp_path / "almost.aiff"
    path.write_bytes(_aiff_bytes(ext))
    _, rate = load_audio(path)
    assert rate == 48000


def test_aiff_rate_is_not_rounded_across_a_real_difference(tmp_path):
    """Rounding must not paper over a genuinely different rate."""
    ext = bytes.fromhex("400eac440000000000")  # 44100
    path = tmp_path / "44k1.aiff"
    path.write_bytes(_aiff_bytes(ext + b"\x00"))
    _, rate = load_audio(path)
    assert rate == 44100


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


# --- signal measurement ---------------------------------------------------

def test_measure_reports_nothing_for_silence():
    peak, rms = measure(np.zeros(1000, dtype=np.float32))
    assert peak == 0.0
    assert rms == 0.0


def test_measure_handles_an_empty_buffer():
    """np.max on an empty array raises; the caller must not have to know that."""
    assert measure(np.zeros(0, dtype=np.float32)) == (0.0, 0.0)


def test_measure_finds_the_peak_regardless_of_sign():
    audio = np.array([0.0, 0.4, -0.9, 0.2], dtype=np.float32)
    peak, _ = measure(audio)
    assert peak == pytest.approx(0.9)


def test_measure_rms_of_a_sine_is_amplitude_over_root_two():
    audio = tone(1.0, rate=48000, freq=100.0)   # amplitude 0.5
    _, rms = measure(audio)
    assert rms == pytest.approx(0.5 / np.sqrt(2), rel=1e-3)


def test_describe_level_names_digital_silence():
    assert describe_level(0.0) == "digital silence"


def test_describe_level_reports_dbfs():
    assert "0.0 dBFS" in describe_level(1.0)
    assert "-6.0 dBFS" in describe_level(0.5)


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


# --- resampling edge cases --------------------------------------------------
#
# The resampler is hand-rolled (Fourier method on numpy) rather than scipy, so
# it carries its own risk and gets its own coverage. Every rate below is one a
# real After Effects project can be set to.

@pytest.mark.parametrize("rate", [88200, 96000, 176400, 192000, 12000, 6000])
def test_resampling_preserves_amplitude_at_real_project_rates(tmp_path, rate):
    seconds = 0.2
    expected_peak = 0.5
    path = write_wav(tmp_path / f"{rate}.wav",
                     tone(seconds, rate, freq=300.0), rate=rate)
    audio, out_rate = load_audio(path)

    peak, _ = measure(audio)
    assert out_rate == 16000
    assert peak == pytest.approx(expected_peak, abs=0.02), (
        f"{rate} Hz resampled to a peak of {peak:.4f}, not {expected_peak}"
    )


def test_resampling_does_not_alias_high_frequencies_into_speech():
    """The reason this is an FFT resample and not linear interpolation.

    A 20 kHz tone is far above 16 kHz's 8 kHz Nyquist. Interpolating naively
    folds it back into the middle of the speech band as a loud tone that was
    never in the audio -- roughly 4 kHz at 0.31 RMS, measured. A bandlimited
    resample removes it instead.
    """
    from app.audio import _resample

    src = 96000
    t = np.arange(int(src * 0.5)) / src
    tone_20k = (0.5 * np.sin(2 * np.pi * 20000 * t)).astype(np.float32)

    resampled = _resample(tone_20k, src, 16000)

    residual = float(np.sqrt(np.mean(resampled.astype(np.float64) ** 2)))
    assert residual < 0.01, (
        f"content above the new Nyquist survived at {residual:.4f} RMS, "
        "which means it aliased into the speech band"
    )


@pytest.mark.parametrize("samples", [1, 2, 3, 4800, 4801])
def test_resampling_survives_awkward_buffer_lengths(samples):
    from app.audio import _resample

    audio = np.sin(np.arange(samples) * 0.01).astype(np.float32)
    out = _resample(audio, 96000, 16000)

    assert out.size == max(1, round(samples * 16000 / 96000))
    assert np.all(np.isfinite(out)), "resampling produced NaN or infinity"


def test_resampling_preserves_a_constant():
    """A DC offset is the simplest thing a resampler can get wrong."""
    from app.audio import _resample

    out = _resample(np.full(9600, 0.5, dtype=np.float32), 96000, 16000)
    assert np.allclose(out, 0.5, atol=1e-4)


# --- measure() on long audio -----------------------------------------------
#
# The naive spelling -- audio.astype(np.float64), abs, ** 2 -- allocates about
# four times the audio's own size to produce two scalars. An hour of 48 kHz
# mono is 691 MB, so that is ~2.8 GB of transient allocation on exactly the
# long comps most likely to be running near the limit already.


def test_measure_matches_the_whole_array_computation():
    """Blocking must not change the answer, including across block edges."""
    rng = np.random.default_rng(7)
    for size in (1, 1000, (1 << 20) - 1, 1 << 20, (1 << 20) + 13, (1 << 21) + 5):
        audio = ((rng.random(size) - 0.5) * 1.8).astype(np.float32)
        wide = audio.astype(np.float64)
        peak, rms = measure(audio)
        assert peak == pytest.approx(float(np.max(np.abs(wide))))
        assert rms == pytest.approx(float(np.sqrt(np.mean(wide ** 2))), rel=1e-9)


def test_measure_does_not_allocate_a_copy_of_the_audio():
    import tracemalloc

    audio = np.zeros(4 << 20, dtype=np.float32)      # 16 MB
    audio[::3] = 0.5
    tracemalloc.start()
    measure(audio)
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert peak_bytes < audio.nbytes // 2, (
        "measure() held %.1f MB of temporaries for a %.1f MB buffer"
        % (peak_bytes / 1e6, audio.nbytes / 1e6)
    )


def test_resample_refuses_audio_it_cannot_hold():
    """The Fourier method needs the whole signal at once.

    Every rate After Effects actually renders at is accepted directly, so this
    only fires on an odd one -- and dying inside numpy with no explanation is
    worse than saying which knob to turn.
    """
    hours_of_16k = np.zeros(2 * 60 * 60 * 16_000, dtype=np.float32)
    with pytest.raises(AudioError) as caught:
        _resample(hours_of_16k, 47_999, 16_000)
    assert "48 kHz" in str(caught.value), str(caught.value)


def test_resample_still_works_on_an_ordinary_length():
    tone = np.sin(np.linspace(0, 40 * np.pi, 8_000, dtype=np.float64)).astype(np.float32)
    out = _resample(tone, 8_000, 16_000)
    assert out.dtype == np.float32
    assert abs(out.size - 16_000) <= 1
