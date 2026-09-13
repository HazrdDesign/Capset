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
from .audio import (
    SILENT_PEAK,
    AudioError,
    describe_level,
    measure,
    read_with_format,
    slice_audio,
)
from .chunking import merge_chunks, plan_chunks, unlag_words
from .models import AudioDiagnostics, TranscriptionResult, Word
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
        audio, sample_rate, source = read_with_format(audio_path)
        duration = len(audio) / sample_rate
        peak, rms = measure(audio)
        log.info(
            "read %.2fs of audio [%s] (%s, rms %.5f)",
            duration, source.describe(), describe_level(peak), rms,
        )

        # Fail here rather than transcribing nothing and calling it a success.
        # A silent file is not a transcription that found no speech: it means
        # After Effects handed us audio with nothing in it, which is something
        # the user can actually fix -- and which used to surface only as the
        # baffling "0 words -> 0 captions".
        if peak < SILENT_PEAK:
            raise AudioError(
                "The audio After Effects rendered is silent (%s over %.1fs). "
                "There was nothing to transcribe. Check that the layer's "
                "audio is switched on and not muted by another layer's solo, "
                "and that audio output is enabled in the Render Queue's "
                "Output Module and Render Settings."
                % (describe_level(peak), duration)
            )

        progress(0.06, "detecting speech")
        spans = detect_speech(audio, sample_rate)

        chunks = plan_chunks(spans, config.MAX_CHUNK_S, config.OVERLAP_S)
        log.info("planned %d chunk(s) from %d speech span(s)", len(chunks), len(spans))

        def diagnostics(chunk_count: int) -> AudioDiagnostics:
            return AudioDiagnostics(
                duration_sec=duration,
                sample_rate=sample_rate,
                peak=peak,
                rms=rms,
                speech_spans=len(spans),
                chunks=chunk_count,
                source_format=source.describe(),
            )

        if not chunks:
            return TranscriptionResult(
                duration_sec=duration, words=[], full_text="",
                diagnostics=diagnostics(0),
            )

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
        # Absolute time first, then the lag comes off: the lag is a property
        # of the model's reporting, not of where a chunk happened to start.
        words: list[Word] = unlag_words(merge_chunks(results), config.WORD_LAG_S)
        if not words:
            # Audible, but nothing recognised. Say what was measured: at this
            # point the difference between "too quiet" and "no speech in it"
            # is the only thing that tells the user what to try next.
            log.warning(
                "no words recognised in %.2fs of audio (%s, %d span(s), "
                "%d chunk(s))",
                duration, describe_level(peak), len(spans), len(chunks),
            )
        return TranscriptionResult(
            duration_sec=duration,
            words=words,
            full_text=words_to_text(words),
            diagnostics=diagnostics(len(chunks)),
        )
