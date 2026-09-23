"""Orchestrator tests using a fake engine -- no model required.

The point of these is that the chunk-offset arithmetic survives the real
code path, not just the unit test in test_chunking.py.
"""

import numpy as np
import pytest

from app import config, transcribe as transcribe_mod
from app.audio import AudioError, SourceFormat
from app.models import Token
from app.transcribe import Transcriber


class FakeEngine:
    """Emits one token per second of the chunk it is handed.

    Timings are chunk-relative, exactly as a real engine returns them, so a
    missing offset shows up as words landing at the wrong absolute time.
    """

    name = "fake"

    def __init__(self):
        self._loaded = False
        self.calls = []

    def load(self):
        self._loaded = True

    def is_loaded(self):
        return self._loaded

    def transcribe_chunk(self, audio, sample_rate):
        seconds = len(audio) / sample_rate
        self.calls.append(seconds)
        index = len(self.calls) - 1
        return [
            Token(text=f"▁c{index}w{i}", start=float(i), end=float(i) + 0.4)
            for i in range(int(seconds))
        ]

    def describe(self):
        return {"engine": "fake", "loaded": self._loaded}


def tone(seconds, rate=config.SAMPLE_RATE, freq=220.0):
    """A buffer with actual signal in it.

    These tests are about chunk-offset arithmetic, not audio content, and they
    used to pass np.zeros as filler. That stopped working when the transcriber
    started rejecting silent audio outright -- a silent file is now an error,
    because reporting "0 words" for one is what sent a real user chasing a
    transcription bug that was really an After Effects render setting. Filler
    with signal in it keeps these tests about what they are testing and leaves
    that check meaningful.
    """
    t = np.linspace(0, seconds, int(seconds * rate), endpoint=False)
    return (0.25 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


@pytest.fixture
def audio_30s():
    return tone(30)


def _patch_audio(monkeypatch, audio, spans, rate=config.SAMPLE_RATE):
    # read_with_format returns (samples, sample_rate, SourceFormat). The third
    # value is what the file on disk actually was, and it is reported to the
    # user -- so the fake supplies a real one rather than None.
    fmt = SourceFormat("WAV", 1, 16, rate)
    monkeypatch.setattr(
        transcribe_mod, "read_with_format", lambda *a, **k: (audio, rate, fmt)
    )
    monkeypatch.setattr(transcribe_mod, "detect_speech", lambda *a, **k: spans)


def test_long_audio_is_split_into_multiple_chunks(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    Transcriber(engine).transcribe("ignored.wav")

    assert len(engine.calls) > 1, "30s must be split; the model caps around 20s"
    assert all(c <= config.MAX_CHUNK_S + 1e-6 for c in engine.calls)


def test_words_land_in_absolute_time_not_chunk_time(monkeypatch, audio_30s):
    """The drift regression, through the real orchestrator."""
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words
    # Every chunk's fake tokens start again at 0.0. If offsets were dropped,
    # the transcript would be full of words at t<20 and nothing beyond it.
    assert max(w.start for w in result.words) > config.MAX_CHUNK_S
    assert max(w.start for w in result.words) <= 30.0


def test_output_is_ordered_and_within_duration(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.duration_sec == pytest.approx(30.0)
    for earlier, later in zip(result.words, result.words[1:]):
        assert earlier.start <= later.start
    for w in result.words:
        assert 0.0 <= w.start <= result.duration_sec + 1e-6


def test_separate_speech_spans_are_offset_independently(monkeypatch):
    """A span starting at 60s must produce words near 60s, not near 0."""
    audio = tone(70)
    _patch_audio(monkeypatch, audio, [(0.0, 5.0), (60.0, 65.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    starts = [w.start for w in result.words]
    assert any(s < 5.0 for s in starts), "expected words from the first span"
    assert any(s >= 60.0 for s in starts), "expected words from the second span"


def test_progress_is_monotonic_and_bounded(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()
    seen = []

    Transcriber(engine).transcribe(
        "ignored.wav", on_progress=lambda p, stage: seen.append(p)
    )

    assert seen
    assert all(0.0 <= p <= 1.0 for p in seen)
    assert seen == sorted(seen), "progress must never go backwards"


def test_cancellation_stops_early(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    Transcriber(engine).transcribe("ignored.wav", should_cancel=lambda: True)

    assert engine.calls == [], "no chunk should be transcribed once cancelled"


def test_empty_speech_returns_empty_result(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words == []
    assert result.full_text == ""
    assert result.duration_sec == pytest.approx(30.0)


# --- silent audio -----------------------------------------------------------
#
# A real run rendered a silent WAV out of After Effects and got back a
# SUCCESSFUL transcription of zero words. The panel printed "0 words -> 0
# captions" and the user went looking for a transcription bug that was really
# a render setting. Silence is now an error that says so.

def test_silent_audio_is_an_error_not_an_empty_success(monkeypatch):
    audio = np.zeros(int(3 * config.SAMPLE_RATE), dtype=np.float32)
    _patch_audio(monkeypatch, audio, [(0.0, 3.0)])
    engine = FakeEngine()
    engine.load()

    with pytest.raises(AudioError) as excinfo:
        Transcriber(engine).transcribe("ignored.wav")

    message = str(excinfo.value)
    assert "silent" in message.lower()
    # The message has to name where to go and look, or it is just a nicer way
    # of saying "0 words".
    assert "Render Queue" in message
    assert "audio output" in message.lower()
    assert engine.calls == [], "silent audio should not reach the engine at all"


def test_nearly_silent_audio_is_also_caught(monkeypatch):
    """Dither-level noise from a silent render is not 'quiet dialogue'."""
    rng = np.random.default_rng(0)
    audio = (rng.standard_normal(int(3 * config.SAMPLE_RATE)) * 1e-7).astype(np.float32)
    _patch_audio(monkeypatch, audio, [(0.0, 3.0)])
    engine = FakeEngine()
    engine.load()

    with pytest.raises(AudioError):
        Transcriber(engine).transcribe("ignored.wav")


def test_quiet_but_real_audio_still_transcribes(monkeypatch):
    """The check must not reject a quiet take. Failing a real recording is a
    worse outcome than the bug this guards against."""
    audio = tone(3) * 0.004      # about -48 dBFS: quiet, but genuinely there
    _patch_audio(monkeypatch, audio, [(0.0, 3.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words, "a quiet but audible take must still be transcribed"


def test_results_carry_diagnostics(monkeypatch, audio_30s):
    """Zero words needs to arrive with the numbers that explain it."""
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.diagnostics is not None
    assert result.diagnostics.duration_sec == pytest.approx(30.0)
    assert result.diagnostics.sample_rate == config.SAMPLE_RATE
    assert result.diagnostics.peak > 0
    assert result.diagnostics.speech_spans == 1
    assert result.diagnostics.chunks >= 1


def test_diagnostics_survive_a_zero_word_result(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words == []
    assert result.diagnostics is not None, (
        "the empty path is exactly when diagnostics matter"
    )
    assert result.diagnostics.speech_spans == 0
    assert result.diagnostics.chunks == 0


def test_native_sample_rate_is_passed_to_the_engine(monkeypatch):
    """AE renders at 48 kHz; onnx-asr resamples. We must not lie about the rate.

    Claiming 16 kHz for 48 kHz audio would make every timestamp come back
    three times too large — captions would drift further and further behind.
    """
    seen = {}

    class RateCapturingEngine(FakeEngine):
        def transcribe_chunk(self, audio, sample_rate):
            seen["rate"] = sample_rate
            return super().transcribe_chunk(audio, sample_rate)

    native = 48000
    audio = tone(3, rate=native)
    _patch_audio(monkeypatch, audio, [(0.0, 3.0)], rate=native)

    engine = RateCapturingEngine()
    engine.load()
    result = Transcriber(engine).transcribe("ignored.wav")

    assert seen["rate"] == native, "engine received the wrong sample rate"
    assert result.duration_sec == pytest.approx(3.0), "duration computed at the wrong rate"


def test_the_emission_lag_comes_off_in_the_pipeline(monkeypatch, audio_30s):
    """The unit is covered in test_chunking; this is the wiring.

    A lag removed in a pure function nothing calls is a lag still on screen.
    """
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()
    monkeypatch.setattr(config, "WORD_LAG_S", 0.5)

    lagged = Transcriber(engine).transcribe("ignored.wav")

    monkeypatch.setattr(config, "WORD_LAG_S", 0.0)
    raw = Transcriber(engine).transcribe("ignored.wav")

    assert len(lagged.words) == len(raw.words)
    # Every word that had room to move, moved by the lag. The first of a chunk
    # can be clipped at zero, so compare the ones that were not.
    moved = [
        (r.start - l.start)
        for l, r in zip(lagged.words, raw.words)
        if r.start >= 0.5
    ]
    assert moved, "no word had room to move"
    assert all(abs(m - 0.5) < 1e-6 for m in moved), moved


def test_the_lag_never_pushes_a_word_before_the_file(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()
    monkeypatch.setattr(config, "WORD_LAG_S", 5.0)

    result = Transcriber(engine).transcribe("ignored.wav")

    assert all(w.start >= 0.0 for w in result.words)
    assert all(w.end >= w.start for w in result.words)


# --- audio alignment, wired in ------------------------------------------------
#
# The unit is covered in test_align.py; this is the wiring, in the same spirit
# as the WORD_LAG_S tests above -- a correction that runs in a function
# nothing calls is a correction still on screen.


def test_align_to_audio_runs_after_the_lag_is_removed(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()
    seen = {}

    def spy(words, audio, sample_rate):
        seen["words"] = list(words)
        seen["sample_rate"] = sample_rate
        return words

    monkeypatch.setattr(transcribe_mod, "align_to_audio", spy)

    result = Transcriber(engine).transcribe("ignored.wav")

    assert "words" in seen, "align_to_audio was never called"
    assert seen["sample_rate"] == config.SAMPLE_RATE
    # What it was handed is the already-unlagged transcript, not raw tokens.
    assert seen["words"] == result.words


def test_align_to_audio_is_skipped_when_disabled(monkeypatch, audio_30s):
    _patch_audio(monkeypatch, audio_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()
    monkeypatch.setattr(config, "ALIGN_TO_AUDIO", False)
    calls = []
    monkeypatch.setattr(
        transcribe_mod, "align_to_audio",
        lambda words, audio, sample_rate: calls.append(1) or words,
    )

    Transcriber(engine).transcribe("ignored.wav")

    assert not calls, "align_to_audio ran despite CAPSET_ALIGN_TO_AUDIO being off"


def test_align_to_audio_is_skipped_for_an_empty_result(monkeypatch, audio_30s):
    """No words means nothing to align -- and no audio-shaped work to do
    for a result that is already empty."""
    _patch_audio(monkeypatch, audio_30s, [])
    engine = FakeEngine()
    engine.load()
    calls = []
    monkeypatch.setattr(
        transcribe_mod, "align_to_audio",
        lambda words, audio, sample_rate: calls.append(1) or words,
    )

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words == []
    assert not calls
