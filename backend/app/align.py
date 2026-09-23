"""Pull word boundaries back onto the audio, using its energy envelope.

The ASR engine reports a word's TIMING, not where the speaker actually
started and stopped saying it -- see onnx_asr_engine._MAX_TOKEN_S and
chunking.unlag_words for the two corrections already applied, and both are
calibrations against typical behaviour, not measurements of this specific
recording. The reported case is the gap a calibration cannot close: a ~0.6s
silence sat in the audio from 12.45s to 13.05s, but the model stamped the
first word after it at ~12.73s -- 0.32s inside the silence, close enough to
the previous word that every mode's maxGapS (segmentation.js) read the pause
as a within-phrase breath and glued the two thoughts into one caption.
maxGapS cannot fix a gap that is measured wrong; the gap has to be measured
right first.

This module does that measurement directly against the decoded audio, LOCALLY
around each boundary rather than once for the whole file (see CONTEXT_S for
why). It never trusts a token boundary it can check: for every pair of
consecutive words, it looks for a genuine run of silence between them and, if
one is there, moves the words' boundaries to its edges. On a clip with no
real silence in it -- a voice over a music bed, which never drops to nothing
-- there is nothing to find, and nothing here changes: see _thresholds() and
the "no clear separation" test, which is the same shape of guard vad.py's
_energy_spans() already uses for the same reason.

Pure numpy, no ASR dependency, so it is testable with synthetic audio and
runs the same whether the words came from onnx-asr or a fake.
"""

from __future__ import annotations

import logging

import numpy as np

from .models import Word

log = logging.getLogger(__name__)

# The envelope's time resolution. Fine enough to find a silence as short as
# MIN_SILENCE_RUN_S below without averaging it away against the speech either
# side of it; coarse enough that an hour of audio is ~360k frames, not
# millions.
FRAME_S = 0.01

# Frames are computed a block at a time rather than by squaring the whole
# file in one call. `measure()` in audio.py hit this exact wall: the obvious
# spelling (widen to float64, square, then reduce) allocates several times
# the audio's own size in temporaries, which is ~2.8 GB of transient memory
# for one hour of 48 kHz mono. Processing in blocks bounds the temporary to
# the block's own size regardless of how long the file is.
_BLOCK_FRAMES = 8192

# A silent run shorter than this is a plosive's closure or a consonant's dip,
# not a pause between thoughts -- and the reported case is a clean ~0.6s, so
# 0.12s comfortably separates "actual quiet" from "the shape of speech" while
# still well under it.
MIN_SILENCE_RUN_S = 0.12

# The two ends of a word may never be pulled past a floor this thin. Without
# it, a word whose neighbours are both trimmed toward it could be squeezed to
# nothing or inverted; with it, the floor here matches minWords' reason for
# existing in segmentation.js -- a boundary is only trustworthy down to a
# point.
MIN_WORD_S = 0.05

# How many decibels below the clip's own speech level counts as quiet enough
# to be silence, rather than a soft word or a dip in a music bed. Chosen so
# ordinary quiet syllables (a handful of dB down) stay above it while a real
# stop -- room tone, or nothing at all -- reliably clears it.
SILENCE_DROP_DB = 20.0

# The threshold is never allowed to sit below (noise_floor + this many dB).
# Without this floor, a very quiet, very flat recording (soft speech close to
# its own noise floor) could compute a threshold so low that ordinary room
# tone between words is misread as speech -- see "no clear separation" below
# for the other half of the same guard.
FLOOR_MARGIN_DB = 3.0

# There must be at least this many dB between the clip's typical speech level
# and its noise floor before any of this is trusted. Below it, quiet and loud
# cannot be told apart -- a synthesiser's constant hum, a compressed music
# bed that never drops out, or a very short clip with too little of either to
# measure. Mirrors vad.py's `speech_level <= floor * 2.0` (a 6 dB ratio) at a
# threshold wide enough to also cover the deliberately narrow-dynamic-range
# fixture in this module's own "music bed" test.
MIN_SEPARATION_DB = 12.0

# How much audio around each boundary is used to work out what "quiet" and
# "loud" mean there. This is a LOCAL measurement, not a whole-file one, and
# that is the whole reason it is a fixed number of seconds rather than a
# fraction of the clip: a 0.6-0.8s pause is a large share of a 3s window
# around it whether the file it sits in is thirty seconds or an hour long,
# but it can be under 1% of the file itself, which is too little of an
# already-extreme percentile (see _thresholds) to move it. Long enough either
# side to reliably include real speech to compare the pause against; short
# enough that a second, unrelated pause nearby does not end up inside the
# same window and confuse which one is "the" boundary.
CONTEXT_S = 1.0

_EPS = 1e-9


def _frame_rms(audio: np.ndarray, sample_rate: int, frame_s: float = FRAME_S) -> np.ndarray:
    """RMS of each `frame_s` frame, computed a block of frames at a time.

    Reshaping the whole file into frames and squaring it in one call would
    widen it to float64 first -- see the module docstring for why that is not
    an option on an hour-long comp. This walks the array in chunks of
    `_BLOCK_FRAMES` frames, matching measure()'s block-then-einsum shape in
    audio.py, so peak transient memory is the block's size, not the file's.
    """
    frame_len = max(1, int(round(sample_rate * frame_s)))
    n_frames = len(audio) // frame_len
    if n_frames == 0:
        return np.zeros(0, dtype=np.float64)

    rms = np.empty(n_frames, dtype=np.float64)
    block_samples = _BLOCK_FRAMES * frame_len
    usable = n_frames * frame_len
    for block_start in range(0, usable, block_samples):
        block_end = min(block_start + block_samples, usable)
        block = audio[block_start:block_end]
        frames_here = block.shape[0] // frame_len
        block = block[: frames_here * frame_len].reshape(frames_here, frame_len)
        # einsum accumulates in float64 without materialising a float64 copy
        # of `block` first -- the same trick measure() uses.
        sums = np.einsum("ij,ij->i", block, block, dtype=np.float64)
        out_start = block_start // frame_len
        rms[out_start:out_start + frames_here] = np.sqrt(sums / frame_len)
    return rms


def _thresholds(frame_rms: np.ndarray) -> float | None:
    """The RMS level below which a frame counts as silent, or None.

    None means "do not trust this clip's dynamic range" -- there is no clear
    floor-to-speech separation to measure a threshold against, so the caller
    must leave every word exactly where the ASR put it. A music bed that
    never drops out produces exactly this: its quietest frames and its
    loudest are close together, because the music itself is what fills both.
    """
    if frame_rms.size < 4:
        return None
    if not np.any(frame_rms > 0):
        # Digital silence from end to end. There is no speech level to
        # measure a threshold against, and nothing here needs aligning to
        # anything -- the caller already rejects a file this quiet before
        # transcription is attempted at all (see audio.SILENT_PEAK).
        return None

    # Percentiles over EVERY frame, real silence included, and deliberately
    # extreme ones (1st/99th, not 10th/90th). A single ~0.6s pause in a
    # 14s-long caption -- the reported case -- is under 5% of the clip's
    # frames; a 10th-percentile floor needs roughly ten times that share of
    # the file to be quiet before it notices, so it would miss exactly the
    # gap this module exists to find. The extreme percentiles still land
    # inside a real quiet-vs-loud split whatever fraction of the file each
    # side is, while a clip with no such split -- the music-bed case -- has
    # no frames extreme enough in either direction to move them apart.
    speech_db = 20.0 * np.log10(np.percentile(frame_rms, 99) + _EPS)
    floor_db = 20.0 * np.log10(np.percentile(frame_rms, 1) + _EPS)

    if speech_db - floor_db < MIN_SEPARATION_DB:
        return None

    threshold_db = max(floor_db + FLOOR_MARGIN_DB, speech_db - SILENCE_DROP_DB)
    return float(10.0 ** (threshold_db / 20.0))


def _silent_runs(frame_rms: np.ndarray, threshold: float, frame_s: float) -> list[tuple[float, float]]:
    """Contiguous runs of frames at or below `threshold`, as (start_s, end_s)."""
    silent = frame_rms <= threshold
    runs: list[tuple[float, float]] = []
    start = None
    for i, is_silent in enumerate(silent):
        if is_silent and start is None:
            start = i
        elif not is_silent and start is not None:
            runs.append((start * frame_s, i * frame_s))
            start = None
    if start is not None:
        runs.append((start * frame_s, len(silent) * frame_s))
    return [r for r in runs if r[1] - r[0] >= MIN_SILENCE_RUN_S]


def _longest_run_in(
    runs: list[tuple[float, float]], window_start: float, window_end: float
) -> tuple[float, float] | None:
    """The longest silent run overlapping [window_start, window_end], clipped to it.

    A word pair's search window can contain more than one qualifying run --
    a speaker who pauses, half-starts a word, and pauses again. The longest
    clipped run is the clearest single boundary in that window; the ties this
    breaks are as arbitrary as which of two equal breaths to pick, which is
    to say it does not matter which wins.

    The clip is only ever taken off the far side, never both: `runs` are
    already at least MIN_SILENCE_RUN_S long in full, and this is used with a
    window whose near edge is a word's OWN start or end -- exactly the
    boundary the run is evidence for moving -- so requiring the clipped
    remainder to still clear MIN_SILENCE_RUN_S would reject the very silence
    the boundary sits inside of. See _run_containing for the point check that
    handles the file's two open ends, where that distinction matters.
    """
    best = None
    best_len = 0.0
    for run_start, run_end in runs:
        lo = max(run_start, window_start)
        hi = min(run_end, window_end)
        if hi - lo > 0 and hi - lo > best_len:
            best = (lo, hi)
            best_len = hi - lo
    return best


def _local_runs(
    frame_rms: np.ndarray, frame_s: float, window_start: float, window_end: float
) -> list[tuple[float, float]]:
    """Silent runs found using only the frames in [window_start, window_end).

    The threshold in `_thresholds` is computed FROM THIS SLICE, not from the
    whole file -- see CONTEXT_S for why a local measurement is the point, not
    an optimisation. Runs come back in absolute time, so callers never have
    to translate.
    """
    n = frame_rms.size
    lo_i = max(0, int(window_start / frame_s))
    hi_i = min(n, int(np.ceil(window_end / frame_s)))
    if hi_i <= lo_i:
        return []

    window = frame_rms[lo_i:hi_i]
    threshold = _thresholds(window)
    if threshold is None:
        return []

    offset = lo_i * frame_s
    return [(s + offset, e + offset) for s, e in _silent_runs(window, threshold, frame_s)]


def _run_containing(runs: list[tuple[float, float]], t: float) -> tuple[float, float] | None:
    """The qualifying silent run that time `t` falls inside, if any.

    Used only for the file's two open ends. A word's reported start can sit
    anywhere inside a leading silence -- right at its front, or, just as
    often, well into it -- and the run is still the leading silence either
    way. Windowing that search the way `_longest_run_in` windows a pair's
    interior would clip the run down to whatever lies between 0 and the
    reported start, which is backwards: a start buried deep in silence is the
    clearer case for moving it, not a weaker one.
    """
    for run_start, run_end in runs:
        if run_start <= t <= run_end:
            return (run_start, run_end)
    return None


def align_to_audio(words: list[Word], audio: np.ndarray, sample_rate: int) -> list[Word]:
    """Move word boundaries onto real silence found in the audio.

    Only ever narrows a word toward a silence that overlaps its own span or
    the gap next to it -- never widens one, never reorders them, never drops
    below MIN_WORD_S. On a clip with no clean quiet-to-loud separation this
    is a no-op end to end: `_thresholds` returns None for every window it is
    asked about, and every word comes back exactly as it went in.

    Every threshold here is LOCAL (see CONTEXT_S) rather than one computed
    once for the whole file. A single pause is measured against the couple
    of seconds around it, not against the clip's overall percentiles -- which
    would need the pause to be a fixed SHARE of the whole file to register,
    and on a long recording with only a handful of real pauses in it, one
    of them can be a fraction of a percent of the total frames.
    """
    if len(words) == 0 or len(audio) == 0:
        return words

    frame_rms = _frame_rms(audio, sample_rate)
    duration = len(audio) / sample_rate
    starts = [w.start for w in words]
    ends = [w.end for w in words]

    # The leading edge: a word whose reported start sits in silence that
    # precedes it (a chunk that opened before speech actually began) has its
    # start pushed forward to where the silence ends.
    lead_runs = _local_runs(frame_rms, FRAME_S, 0.0, min(ends[0], starts[0] + CONTEXT_S))
    lead = _run_containing(lead_runs, starts[0])
    if lead is not None:
        starts[0] = max(starts[0], min(ends[0] - MIN_WORD_S, lead[1]))

    # Between each pair, in order: B's own edit in one iteration is visible to
    # the next one, which is what lets a word entirely swallowed by a long
    # silence still end up honestly short rather than needing its neighbour
    # on the OTHER side to fix it too. The window is clamped to each word's
    # OWN span on the far side, so a second, unrelated pause just past B does
    # not leak into the measurement for the A/B boundary.
    for i in range(len(words) - 1):
        window_lo = max(starts[i], ends[i] - CONTEXT_S)
        window_hi = min(ends[i + 1], starts[i + 1] + CONTEXT_S)
        runs = _local_runs(frame_rms, FRAME_S, window_lo, window_hi)
        run = _longest_run_in(runs, starts[i], ends[i + 1])
        if run is None:
            continue
        silence_start, silence_end = run
        ends[i] = max(starts[i] + MIN_WORD_S, min(ends[i], silence_start))
        starts[i + 1] = min(ends[i + 1] - MIN_WORD_S, max(starts[i + 1], silence_end))

    # The trailing edge: a chunk that keeps running past the last word (the
    # energy gate holds a span open through trailing music, per
    # onnx_asr_engine._MAX_FINAL_TOKEN_S) can leave that word's reported end
    # sitting in silence after it. Pull it back to where the silence starts.
    trail_runs = _local_runs(
        frame_rms, FRAME_S, max(starts[-1], ends[-1] - CONTEXT_S), duration
    )
    trail = _run_containing(trail_runs, ends[-1])
    if trail is not None:
        ends[-1] = min(ends[-1], max(starts[-1] + MIN_WORD_S, trail[0]))

    aligned = []
    for w, new_start, new_end in zip(words, starts, ends):
        aligned.append(Word(text=w.text, start=new_start, end=new_end, confidence=w.confidence))
    return aligned
