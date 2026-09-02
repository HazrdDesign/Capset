"""Orchestration: audio file in, absolute-timed words out.

Deliberately thin. The parts that are easy to get wrong -- token merging and
chunk stitching -- live in `tokens.py` and `chunking.py`, are pure, and are
covered by tests that need no model.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from . import config
from .audio import load_audio, slice_audio
from .chunking import merge_chunks, plan_chunks
from .models import TranscriptionResult, Word
from .tokens import merge_tokens_to_words, words_to_text
from .vad import detect_speech

log = logging.getLogger(__name__)

ProgressFn = Callable[[float, str], None]


def _noop(progress: float, stage: str) -> None:
    return None


class Transcriber:
    def __init__(self, engine):
        self.engine = engine

    def load(self) -> None:
        self.engine.load()

    def is_loaded(self) -> bool:
        return self.engine.is_loaded()

    def transcribe(
        self,
        audio_path: str | Path,
        on_progress: ProgressFn | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> TranscriptionResult:
        progress = on_progress or _noop
        cancelled = should_cancel or (lambda: False)

        progress(0.02, "reading audio")
        # load_audio already resamples to a rate onnx-asr accepts if the
        # rendered file's native rate isn't one of the ones it supports.
        audio, sample_rate = load_audio(audio_path)
        duration = len(audio) / sample_rate
        log.info("read %.2fs of audio at %d Hz", duration, sample_rate)

        progress(0.06, "detecting speech")
        spans = detect_speech(audio, sample_rate)

        chunks = plan_chunks(spans, config.MAX_CHUNK_S, config.OVERLAP_S)
        log.info("planned %d chunk(s) from %d speech span(s)", len(chunks), len(spans))
        if not chunks:
            return TranscriptionResult(duration_sec=duration, words=[], full_text="")

        results: list[tuple] = []
        for index, chunk in enumerate(chunks):
            if cancelled():
                log.info("cancelled after %d/%d chunks", index, len(chunks))
                break
            samples = slice_audio(audio, chunk.start, chunk.end, sample_rate)
            if samples.size == 0:
                continue
            tokens = self.engine.transcribe_chunk(samples, sample_rate)
            results.append((chunk, merge_tokens_to_words(tokens)))
            # 0.10 -> 0.98 across chunks, leaving room either side for the
            # decode/VAD prologue and the stitching epilogue.
            progress(
                0.10 + 0.88 * ((index + 1) / len(chunks)),
                f"transcribing {index + 1}/{len(chunks)}",
            )

        progress(0.99, "stitching")
        words: list[Word] = merge_chunks(results)
        return TranscriptionResult(
            duration_sec=duration,
            words=words,
            full_text=words_to_text(words),
        )
