"""Tests for aligning word boundaries to the audio's own silence.

The reported bug, exactly: a ~0.6s silence sat in the audio from 12.45s to
13.05s, but the model stamped the word after it at ~12.73s -- 0.32s inside
the silence, close enough to the previous word that the panel's segmentation
read the whole thing as one continuous phrase and glued a new thought onto
the end of the old one. `align_to_audio` is the fix on the backend side: it
never trusts a boundary it can check against the decoded audio.
"""

import numpy as np
import pytest

from app.align import (
    FRAME_S,
    MIN_SILENCE_RUN_S,
    MIN_WORD_S,
    _frame_rms,
    _silent_runs,
    _thresholds,
    align_to_audio,
)
from app.models import Word

RATE = 16_000


def tone(seconds, rate=RATE, freq=180.0, amp=0.3, seed=0):
    t = np.linspace(0, seconds, int(round(seconds * rate)), endpoint=False)
    # A touch of noise so the frame RMS is not a mathematically perfect
    # sinusoid -- real speech never is, and a few real recordings' worth of
    # jitter is what the threshold has to be robust to.
    rng = np.random.default_rng(seed)
    jitter = 0.01 * rng.standard_normal(t.size)
    return (amp * np.sin(2 * np.pi * freq * t) + jitter).astype(np.float32)


def silence(seconds, rate=RATE):
    return np.zeros(int(round(seconds * rate)), dtype=np.float32)


def noise(seconds, rate=RATE, level=0.2, seed=0):
    rng = np.random.default_rng(seed)
    return (level * rng.standard_normal(int(round(seconds * rate)))).astype(np.float32)


def word(text, start, end):
    return Word(text=text, start=start, end=end)


# --- the reported case -------------------------------------------------------


def test_the_reported_silence_pulls_the_gap_open_to_its_real_length():
    """B.start moves from ~12.73 (early-stamped, inside the silence) to
    ~13.05 (where speech actually resumes), and the measured gap goes from
    ~0.25s -- below every mode's maxGapS -- to ~0.6s."""
    audio = np.concatenate([
        tone(12.45, freq=170.0, seed=1),
        silence(0.60),
        tone(0.90, freq=170.0, seed=2),
    ])
    words = [word("career,", 0.00, 12.45), word("I", 12.73, 13.95)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].end == pytest.approx(12.45, abs=0.02)
    assert out[1].start == pytest.approx(13.05, abs=0.02)
    assert out[1].start - out[0].end == pytest.approx(0.60, abs=0.03)
    # Nothing else about the words changed.
    assert out[0].text == "career," and out[1].text == "I"
    assert out[1].end == 13.95


def test_a_gap_already_measured_honestly_is_left_alone():
    """If the reported gap already matches the real silence, moving it would
    only add risk for no benefit."""
    audio = np.concatenate([tone(1.0, seed=3), silence(0.6), tone(1.0, seed=4)])
    words = [word("a", 0.0, 1.0), word("b", 1.6, 2.6)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].end == pytest.approx(1.0, abs=0.02)
    assert out[1].start == pytest.approx(1.6, abs=0.02)


# --- the music-bed guard ------------------------------------------------------


def test_a_music_bed_that_never_drops_out_yields_no_changes():
    """The clip this whole rule exists NOT to touch: a voice over a constant
    bed has no frame quieter than any other by more than a few dB, so there
    is no silence for this to find. Every gap here is already zero, exactly
    as onnx_asr_engine reports it in that material -- see segmentation.js's
    own "reported case" for the same clip from the other side."""
    audio = tone(6.0, freq=200.0, amp=0.25, seed=5)
    words = [
        word("Going", 0.000, 0.334), word("into", 0.334, 0.459),
        word("my", 0.459, 0.543), word("career,", 0.543, 0.960),
        word("I", 0.960, 1.127), word("think", 1.127, 1.293),
    ]

    out = align_to_audio(words, audio, RATE)

    assert [(w.start, w.end) for w in out] == [(w.start, w.end) for w in words]


def test_a_quiet_passage_within_a_bed_is_not_mistaken_for_silence():
    """A softer verse is not silence: the ratio between it and the louder
    passage is well under the 12 dB separation this requires before it
    trusts anything is quiet enough to be a real stop."""
    audio = np.concatenate([tone(2.0, amp=0.25, seed=6), tone(2.0, amp=0.08, seed=7)])
    words = [word("a", 0.0, 1.0), word("b", 1.0, 3.0), word("c", 3.0, 4.0)]

    out = align_to_audio(words, audio, RATE)

    assert [(w.start, w.end) for w in out] == [(w.start, w.end) for w in words]


def test_continuous_noise_with_no_speech_shape_yields_no_changes():
    audio = noise(3.0, level=0.15, seed=8)
    words = [word("x", 0.0, 1.5), word("y", 1.5, 3.0)]

    out = align_to_audio(words, audio, RATE)

    assert [(w.start, w.end) for w in out] == [(w.start, w.end) for w in words]


# --- leading and trailing silence ---------------------------------------------


def test_a_start_that_sits_in_leading_silence_is_pushed_to_speech_onset():
    audio = np.concatenate([silence(0.30), tone(1.0, seed=9)])
    words = [word("hi", 0.05, 1.30)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].start == pytest.approx(0.30, abs=0.02)
    assert out[0].end == 1.30, "the end was not near any silence and must not move"


def test_an_end_that_runs_into_trailing_silence_is_pulled_back():
    audio = np.concatenate([tone(1.0, seed=10), silence(0.40)])
    words = [word("bye", 0.0, 1.35)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].start == 0.0
    assert out[0].end == pytest.approx(1.00, abs=0.02)


def test_leading_and_trailing_silence_together_do_not_invert_a_short_word():
    audio = np.concatenate([silence(0.30), tone(0.20, seed=11), silence(0.30)])
    words = [word("no", 0.05, 0.75)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].start < out[0].end
    assert out[0].end - out[0].start >= MIN_WORD_S - 1e-9
    assert out[0].start == pytest.approx(0.30, abs=0.02)
    assert out[0].end == pytest.approx(0.50, abs=0.02)


# --- ordering, non-overlap, and the floor --------------------------------------


def test_a_word_entirely_inside_a_long_silence_keeps_the_floor_without_inverting():
    """Reported timings can place a whole word inside what the audio shows is
    silence. Rather than also having to move its END to keep it non-empty --
    which risks colliding with the NEXT word -- its start is only pushed up
    to (its own end minus the floor), so it survives as the shortest word the
    floor allows and nothing after it is disturbed."""
    audio = np.concatenate([tone(0.5, seed=12), silence(1.5), tone(0.5, seed=13)])
    words = [word("one", 0.0, 0.5), word("two", 0.7, 0.9), word("three", 2.0, 2.5)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].end == pytest.approx(0.5, abs=0.02)
    assert out[1].end == 0.9, "B.end is never moved by this rule"
    assert out[1].end - out[1].start == pytest.approx(MIN_WORD_S, abs=1e-6)
    assert out[2].start == pytest.approx(2.0, abs=0.02)
    # Ordered and non-overlapping throughout.
    for a, b in zip(out, out[1:]):
        assert a.end <= b.start + 1e-9
        assert a.start <= a.end


def test_output_is_always_ordered_and_non_overlapping():
    audio = np.concatenate([
        tone(1.0, seed=14), silence(0.5), tone(1.0, seed=15),
        silence(0.5), tone(1.0, seed=16),
    ])
    words = [
        word("a", 0.0, 1.0), word("b", 1.20, 2.5),   # b early-stamped
        word("c", 2.60, 4.0),                         # c early-stamped too
    ]

    out = align_to_audio(words, audio, RATE)

    for a, b in zip(out, out[1:]):
        assert a.end <= b.start + 1e-9
    for w in out:
        assert w.start <= w.end


def test_words_never_move_earlier_than_the_file_or_later_than_it_started():
    """The floor and the never-widen rule together mean a start never goes
    negative and an end never runs past where it began plus the file."""
    audio = np.concatenate([silence(0.2), tone(1.0, seed=17)])
    words = [word("first", 0.0, 1.2)]

    out = align_to_audio(words, audio, RATE)

    assert out[0].start >= 0.0
    assert out[0].end <= 1.2


def test_empty_word_list_is_a_no_op():
    assert align_to_audio([], tone(1.0), RATE) == []


def test_empty_audio_is_a_no_op():
    words = [word("a", 0.0, 0.5)]
    assert align_to_audio(words, np.zeros(0, dtype=np.float32), RATE) == words


# --- the envelope and threshold, directly --------------------------------------


def test_frame_rms_is_zero_over_true_silence():
    rms = _frame_rms(silence(1.0), RATE)
    assert rms.size > 0
    assert np.all(rms == 0.0)


def test_frame_rms_of_a_tone_is_amplitude_over_root_two():
    amp = 0.4
    audio = (amp * np.sin(2 * np.pi * 220 * np.arange(RATE) / RATE)).astype(np.float32)
    rms = _frame_rms(audio, RATE)
    # A whole number of cycles per 10ms frame keeps this tight.
    assert np.median(rms) == pytest.approx(amp / np.sqrt(2), rel=0.05)


def test_frame_rms_frame_count_matches_the_frame_length():
    audio = np.zeros(RATE, dtype=np.float32)  # exactly 1.0s
    rms = _frame_rms(audio, RATE)
    frame_len = int(round(RATE * FRAME_S))
    assert rms.size == RATE // frame_len


def test_thresholds_is_none_for_a_flat_signal():
    rms = _frame_rms(tone(2.0, amp=0.2, seed=20), RATE)
    assert _thresholds(rms) is None


def test_thresholds_finds_a_level_between_floor_and_speech_for_real_contrast():
    audio = np.concatenate([tone(1.0, amp=0.3, seed=21), silence(1.0)])
    rms = _frame_rms(audio, RATE)
    threshold = _thresholds(rms)
    assert threshold is not None
    assert 0.0 < threshold < 0.3


def test_silent_runs_ignores_gaps_shorter_than_the_minimum():
    """A blip under MIN_SILENCE_RUN_S must not register as a pause -- that is
    the difference between a consonant's closure and a real stop."""
    audio = np.concatenate([
        tone(0.5, seed=22), silence(MIN_SILENCE_RUN_S / 2), tone(0.5, seed=23),
    ])
    rms = _frame_rms(audio, RATE)
    threshold = _thresholds(rms)
    assert threshold is not None
    assert _silent_runs(rms, threshold, FRAME_S) == []


def test_silent_runs_finds_a_run_at_or_above_the_minimum():
    audio = np.concatenate([
        tone(0.5, seed=24), silence(MIN_SILENCE_RUN_S * 2), tone(0.5, seed=25),
    ])
    rms = _frame_rms(audio, RATE)
    threshold = _thresholds(rms)
    assert threshold is not None
    runs = _silent_runs(rms, threshold, FRAME_S)
    assert len(runs) == 1
    assert runs[0][1] - runs[0][0] == pytest.approx(MIN_SILENCE_RUN_S * 2, abs=FRAME_S * 2)


# --- memory: the envelope must not widen the whole file at once ---------------
#
# measure() in audio.py hit exactly this wall: squaring an hour of 48 kHz
# mono in one call allocates ~2.8 GB of transient float64 to produce two
# scalars. _frame_rms walks the array in blocks for the same reason.


def test_frame_rms_does_not_allocate_a_copy_of_the_audio():
    import tracemalloc

    audio = tone(300.0, rate=48_000, amp=0.3, seed=26)  # 5 minutes, ~57.6 MB
    tracemalloc.start()
    rms = _frame_rms(audio, 48_000)
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert rms.size > 0
    assert peak_bytes < audio.nbytes, (
        "_frame_rms held %.1f MB of temporaries for a %.1f MB buffer"
        % (peak_bytes / 1e6, audio.nbytes / 1e6)
    )


def test_align_to_audio_is_correct_on_a_long_array():
    """Not a timing benchmark -- a correctness check that block-wise
    processing finds the same silence a small array would, once the array is
    large enough that a bug in the block bookkeeping (an off-by-one at a
    block edge, say) would have somewhere to hide."""
    rate = 16_000
    long_speech = tone(150.0, rate=rate, freq=160.0, seed=27)
    audio = np.concatenate([long_speech, silence(0.8), tone(5.0, rate=rate, freq=160.0, seed=28)])
    words = [word("a", 0.0, 150.0), word("b", 150.30, 155.0)]  # b early-stamped

    out = align_to_audio(words, audio, rate)

    assert out[0].end == pytest.approx(150.0, abs=0.02)
    assert out[1].start == pytest.approx(150.8, abs=0.02)


# --- the CAPSET_ALIGN_TO_AUDIO env var -----------------------------------------
#
# Mirrors test_model_dir.py's pattern for CAPSET_MODEL_DIR: the flag is read
# once at import time, so exercising every value needs a reload.


def test_align_to_audio_defaults_on(monkeypatch):
    import importlib

    from app import config

    monkeypatch.delenv("CAPSET_ALIGN_TO_AUDIO", raising=False)
    reloaded = importlib.reload(config)
    try:
        assert reloaded.ALIGN_TO_AUDIO is True
    finally:
        importlib.reload(config)


@pytest.mark.parametrize("value", ["0", "false", "False", "no", "off"])
def test_align_to_audio_can_be_switched_off(monkeypatch, value):
    import importlib

    from app import config

    monkeypatch.setenv("CAPSET_ALIGN_TO_AUDIO", value)
    reloaded = importlib.reload(config)
    try:
        assert reloaded.ALIGN_TO_AUDIO is False, repr(value)
    finally:
        monkeypatch.delenv("CAPSET_ALIGN_TO_AUDIO", raising=False)
        importlib.reload(config)


@pytest.mark.parametrize("value", ["1", "true", "yes", "on"])
def test_align_to_audio_stays_on_for_other_values(monkeypatch, value):
    import importlib

    from app import config

    monkeypatch.setenv("CAPSET_ALIGN_TO_AUDIO", value)
    reloaded = importlib.reload(config)
    try:
        assert reloaded.ALIGN_TO_AUDIO is True, repr(value)
    finally:
        monkeypatch.delenv("CAPSET_ALIGN_TO_AUDIO", raising=False)
        importlib.reload(config)
