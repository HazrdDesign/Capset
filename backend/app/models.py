"""Core data types shared across the backend.

Deliberately free of any ASR-library imports so the pure timing logic in
`tokens.py` and `chunking.py` stays testable without a model present.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Token:
    """One decoder token with its timing, as returned by the ASR engine.

    Parakeet uses SentencePiece BPE, so a token is usually a word *piece*.
    `text` is the raw token including any word-boundary marker.
    """

    text: str
    start: float
    end: float
    confidence: float | None = None


@dataclass(frozen=True)
class Word:
    """A whole word with timing, reassembled from one or more tokens."""

    text: str
    start: float
    end: float
    confidence: float | None = None


@dataclass(frozen=True)
class Chunk:
    """A span of the source audio to transcribe as one unit.

    `start`/`end` are absolute seconds in the source file. Engines return
    timings relative to the chunk, which `chunking.merge_chunks` shifts back
    into absolute time.
    """

    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class AudioDiagnostics:
    """What the backend measured about the audio it was handed.

    Returned with every result, successful or empty. Zero words used to be
    indistinguishable from a silent file, a mis-rendered file and a genuine
    absence of speech -- the panel printed "0 words" for all three and the user
    had nothing to act on. These are the numbers that tell them apart.
    """

    duration_sec: float
    sample_rate: int
    peak: float
    rms: float
    speech_spans: int
    chunks: int


@dataclass
class TranscriptionResult:
    duration_sec: float
    words: list[Word] = field(default_factory=list)
    full_text: str = ""
    diagnostics: AudioDiagnostics | None = None
