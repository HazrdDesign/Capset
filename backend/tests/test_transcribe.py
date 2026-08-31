"""Orchestrator tests using a fake engine -- no model required.

The point of these is that the chunk-offset arithmetic survives the real
code path, not just the unit test in test_chunking.py.
"""

import numpy as np
import pytest

from app import config, transcribe as transcribe_mod
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


@pytest.fixture
def silence_30s():
    return np.zeros(int(30 * config.SAMPLE_RATE), dtype=np.float32)


def _patch_audio(monkeypatch, audio, spans):
    monkeypatch.setattr(transcribe_mod, "load_audio", lambda *a, **k: audio)
    monkeypatch.setattr(transcribe_mod, "detect_speech", lambda *a, **k: spans)


def test_long_audio_is_split_into_multiple_chunks(monkeypatch, silence_30s):
    _patch_audio(monkeypatch, silence_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    Transcriber(engine).transcribe("ignored.wav")

    assert len(engine.calls) > 1, "30s must be split; the model caps around 20s"
    assert all(c <= config.MAX_CHUNK_S + 1e-6 for c in engine.calls)


def test_words_land_in_absolute_time_not_chunk_time(monkeypatch, silence_30s):
    """The drift regression, through the real orchestrator."""
    _patch_audio(monkeypatch, silence_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words
    # Every chunk's fake tokens start again at 0.0. If offsets were dropped,
    # the transcript would be full of words at t<20 and nothing beyond it.
    assert max(w.start for w in result.words) > config.MAX_CHUNK_S
    assert max(w.start for w in result.words) <= 30.0


def test_output_is_ordered_and_within_duration(monkeypatch, silence_30s):
    _patch_audio(monkeypatch, silence_30s, [(0.0, 30.0)])
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
    audio = np.zeros(int(70 * config.SAMPLE_RATE), dtype=np.float32)
    _patch_audio(monkeypatch, audio, [(0.0, 5.0), (60.0, 65.0)])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    starts = [w.start for w in result.words]
    assert any(s < 5.0 for s in starts), "expected words from the first span"
    assert any(s >= 60.0 for s in starts), "expected words from the second span"


def test_progress_is_monotonic_and_bounded(monkeypatch, silence_30s):
    _patch_audio(monkeypatch, silence_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()
    seen = []

    Transcriber(engine).transcribe(
        "ignored.wav", on_progress=lambda p, stage: seen.append(p)
    )

    assert seen
    assert all(0.0 <= p <= 1.0 for p in seen)
    assert seen == sorted(seen), "progress must never go backwards"


def test_cancellation_stops_early(monkeypatch, silence_30s):
    _patch_audio(monkeypatch, silence_30s, [(0.0, 30.0)])
    engine = FakeEngine()
    engine.load()

    Transcriber(engine).transcribe("ignored.wav", should_cancel=lambda: True)

    assert engine.calls == [], "no chunk should be transcribed once cancelled"


def test_empty_speech_returns_empty_result(monkeypatch, silence_30s):
    _patch_audio(monkeypatch, silence_30s, [])
    engine = FakeEngine()
    engine.load()

    result = Transcriber(engine).transcribe("ignored.wav")

    assert result.words == []
    assert result.full_text == ""
    assert result.duration_sec == pytest.approx(30.0)
