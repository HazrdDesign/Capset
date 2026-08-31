"""Speech detection, used to pick chunk boundaries.

Cutting inside silence keeps words whole, so VAD spans make better chunk
edges than a fixed grid. When no VAD backend is available the whole file
becomes one span -- `chunking.plan_chunks` still enforces the model's length
limit, so transcription degrades in quality of cut, never in correctness.

The `silero-vad` import below is LAZY AND OPTIONAL on purpose. That pip
package hard-depends on torch and torchaudio, which would pull all of PyTorch
into the shipped bundle and inflate the installer from ~400 MB to 3-4 GB --
exactly what the ONNX architecture exists to avoid. It is therefore NOT in
requirements.txt. If a developer happens to have it installed it gets used;
otherwise the energy gate takes over. To ship real VAD, run Silero's ONNX
model through onnxruntime directly rather than adding the package back.
"""

from __future__ import annotations

import logging

import numpy as np

from .config import SAMPLE_RATE

log = logging.getLogger(__name__)

# Speech shorter than this is almost always a click or breath.
MIN_SPEECH_S = 0.20
# Gaps shorter than this are within-sentence pauses, not real boundaries.
MIN_SILENCE_S = 0.30
# Padding either side so a cut never clips a word's onset or tail.
PAD_S = 0.15


def detect_speech(
    audio: np.ndarray, sample_rate: int = SAMPLE_RATE
) -> list[tuple[float, float]]:
    """Return speech spans as (start_s, end_s).

    Tries Silero VAD, falls back to energy gating, and finally to the whole
    file. Any failure is a downgrade in cut quality, never an error.
    """
    duration = len(audio) / sample_rate
    if duration <= 0:
        return []

    try:
        spans = _silero_spans(audio, sample_rate)
        if spans:
            return spans
        log.info("VAD found no speech; treating whole file as one span")
    except Exception as exc:
        log.warning("Silero VAD unavailable (%s); falling back to energy gate", exc)
        try:
            spans = _energy_spans(audio, sample_rate)
            if spans:
                return spans
        except Exception as inner:
            log.warning("energy gate failed (%s); using whole file", inner)

    return [(0.0, duration)]


def _silero_spans(audio: np.ndarray, sample_rate: int) -> list[tuple[float, float]]:
    from silero_vad import get_speech_timestamps, load_silero_vad  # type: ignore

    model = load_silero_vad(onnx=True)
    stamps = get_speech_timestamps(
        audio,
        model,
        sampling_rate=sample_rate,
        min_speech_duration_ms=int(MIN_SPEECH_S * 1000),
        min_silence_duration_ms=int(MIN_SILENCE_S * 1000),
        speech_pad_ms=int(PAD_S * 1000),
    )
    duration = len(audio) / sample_rate
    return [
        (max(0.0, s["start"] / sample_rate), min(duration, s["end"] / sample_rate))
        for s in stamps
    ]


def _energy_spans(audio: np.ndarray, sample_rate: int) -> list[tuple[float, float]]:
    """Crude RMS gate. Only a safety net when Silero is missing."""
    frame = max(1, int(0.03 * sample_rate))
    usable = (len(audio) // frame) * frame
    if usable == 0:
        return []
    frames = audio[:usable].reshape(-1, frame)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    if not np.any(rms > 0):
        return []

    # Relative threshold: speech level varies far too much between sources
    # for any absolute dB figure to hold up.
    threshold = max(np.percentile(rms, 30) * 2.0, np.max(rms) * 0.05)
    voiced = rms > threshold
    return _merge_flags(voiced, frame / sample_rate, len(audio) / sample_rate)


def _merge_flags(
    voiced: np.ndarray, frame_s: float, duration: float
) -> list[tuple[float, float]]:
    spans: list[tuple[float, float]] = []
    start: float | None = None
    for index, is_voiced in enumerate(voiced):
        t = index * frame_s
        if is_voiced and start is None:
            start = t
        elif not is_voiced and start is not None:
            spans.append((start, t))
            start = None
    if start is not None:
        spans.append((start, duration))

    merged: list[tuple[float, float]] = []
    for span_start, span_end in spans:
        padded = (max(0.0, span_start - PAD_S), min(duration, span_end + PAD_S))
        if merged and padded[0] - merged[-1][1] < MIN_SILENCE_S:
            merged[-1] = (merged[-1][0], padded[1])
        else:
            merged.append(padded)
    return [(s, e) for s, e in merged if e - s >= MIN_SPEECH_S]
