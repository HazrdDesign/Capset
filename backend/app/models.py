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


@dataclass
class TranscriptionResult:
    duration_sec: float
    words: list[Word] = field(default_factory=list)
    full_text: str = ""
