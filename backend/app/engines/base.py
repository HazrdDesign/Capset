"""The ASR engine seam.

Everything above this interface deals in `Token`s with chunk-relative
timings, so the rest of the backend never learns which runtime produced
them. That is what lets Windows and macOS share one code path today, and
lets a faster platform-native engine (parakeet-mlx, sherpa-onnx) drop in
later without touching the chunking, stitching, or HTTP layers.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from ..models import Token


class EngineUnavailable(RuntimeError):
    """Raised when an engine's runtime or model cannot be loaded."""


@runtime_checkable
class AsrEngine(Protocol):
    name: str

    def load(self) -> None:
        """Load the model. Called once at startup; may be slow."""

    def is_loaded(self) -> bool: ...

    def transcribe_chunk(self, audio: np.ndarray, sample_rate: int) -> list[Token]:
        """Transcribe one chunk of mono float32 audio.

        Returns tokens with timings **relative to the start of this chunk**.
        Shifting them into absolute source time is `chunking.merge_chunks`'
        job, not the engine's.
        """

    def describe(self) -> dict:
        """Human-readable engine/provider info, surfaced by /health."""
