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
# Detected spans must retain at least this share of the signal's total energy.
# Below it, the gate is assumed to be discarding speech and the whole file is
# transcribed instead. Silence carries almost no energy, so a correct gate
# comfortably clears this.
MIN_ENERGY_RETAINED = 0.90


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
    """RMS gate keyed to the NOISE FLOOR, never the peak.

    The previous threshold was `max(percentile(rms, 30) * 2, max(rms) * 0.05)`.
    Keying off `max(rms)` made a single loud transient — a door closing, a mic
    bump, one emphatic word — raise the threshold above ordinary speech, so
    that transient became the only detected span. Reproduced: 11s of speech
    plus one 30ms bump yielded 0.36s of "speech", silently discarding 97% of
    the dialogue while the job reported success.

    Two changes prevent that class of failure:

    1. The speech level is estimated with a high percentile rather than the
       maximum, so one outlier frame cannot move it.
    2. Whatever the threshold decides, the result is only trusted if the
       detected spans still contain nearly all of the signal's ENERGY. Silence
       carries almost none, so a correct gate cuts duration while keeping
       energy. Dropping energy means dropping speech.

    Returning [] is safe: the caller falls back to transcribing the whole
    file. That costs a little time; missing speech costs the user their work.
    """
    frame = max(1, int(0.03 * sample_rate))
    usable = (len(audio) // frame) * frame
    if usable == 0:
        return []
    frames = audio[:usable].reshape(-1, frame)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    if not np.any(rms > 0):
        return []

    # Percentiles, not min/max: both ends must survive a few outlier frames.
    floor = float(np.percentile(rms, 20))
    speech_level = float(np.percentile(rms, 90))

    # No clear gap between quiet and loud means this is either continuous
    # speech or continuous noise. Either way there is nothing safe to cut.
    if speech_level <= floor * 2.0:
        log.info("no clear speech/silence separation; using the whole file")
        return []

    threshold = floor + 0.20 * (speech_level - floor)
    voiced = rms > threshold
    spans = _merge_flags(voiced, frame / sample_rate, len(audio) / sample_rate)
    if not spans:
        return []

    # The real safety net. Compare energy inside the spans against the total.
    energy = rms ** 2
    total_energy = float(np.sum(energy))
    if total_energy <= 0:
        return []

    frame_s = frame / sample_rate
    kept = np.zeros(len(rms), dtype=bool)
    for span_start, span_end in spans:
        lo = max(0, int(span_start / frame_s))
        hi = min(len(rms), int(np.ceil(span_end / frame_s)))
        kept[lo:hi] = True
    retained = float(np.sum(energy[kept])) / total_energy

    if retained < MIN_ENERGY_RETAINED:
        log.warning(
            "speech detection would discard %.1f%% of the audio's energy "
            "(%d span(s), %.2fs of %.2fs); using the whole file instead",
            100 * (1 - retained),
            len(spans),
            sum(e - s for s, e in spans),
            len(audio) / sample_rate,
        )
        return []

    return spans


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
