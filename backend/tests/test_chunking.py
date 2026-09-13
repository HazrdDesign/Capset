"""Tests for chunk planning and absolute-time stitching."""

import pytest

from app.chunking import (
    DEFAULT_MAX_CHUNK_S,
    merge_chunks,
    offset_words,
    plan_chunks,
    unlag_words,
)
from app.models import Chunk, Word


def word(text, start, end):
    return Word(text=text, start=start, end=end)


# --- plan_chunks -----------------------------------------------------------


def test_short_span_passes_through_untouched():
    """Boundaries already in silence are the cleanest cut, so do not re-cut."""
    assert plan_chunks([(0.0, 5.0)], max_chunk_s=20.0) == [Chunk(0.0, 5.0)]


def test_span_at_exactly_the_limit_is_not_split():
    assert plan_chunks([(0.0, 20.0)], max_chunk_s=20.0) == [Chunk(0.0, 20.0)]


def test_long_span_is_split_with_overlap():
    chunks = plan_chunks([(0.0, 50.0)], max_chunk_s=20.0, overlap_s=2.0)
    assert all(c.duration <= 20.0 + 1e-9 for c in chunks)
    # Consecutive chunks must overlap so a word on the cut is not lost.
    for earlier, later in zip(chunks, chunks[1:]):
        assert later.start < earlier.end
    assert chunks[0].start == 0.0
    assert chunks[-1].end == 50.0


def test_long_span_chunks_cover_the_whole_span():
    chunks = plan_chunks([(3.0, 70.0)], max_chunk_s=20.0, overlap_s=2.0)
    covered_start = min(c.start for c in chunks)
    covered_end = max(c.end for c in chunks)
    assert covered_start == 3.0
    assert covered_end == 70.0
    # No gaps between consecutive chunks.
    for earlier, later in zip(chunks, chunks[1:]):
        assert later.start <= earlier.end


def test_no_chunk_ever_exceeds_the_model_limit():
    """The whole reason this module exists -- Parakeet rejects long audio."""
    spans = [(0.0, 3.0), (5.0, 130.0), (140.0, 141.5)]
    for chunk in plan_chunks(spans, max_chunk_s=DEFAULT_MAX_CHUNK_S):
        assert chunk.duration <= DEFAULT_MAX_CHUNK_S + 1e-9


def test_multiple_spans_are_kept_separate():
    chunks = plan_chunks([(0.0, 4.0), (10.0, 13.0)], max_chunk_s=20.0)
    assert chunks == [Chunk(0.0, 4.0), Chunk(10.0, 13.0)]


def test_empty_and_degenerate_spans_are_dropped():
    assert plan_chunks([]) == []
    assert plan_chunks([(5.0, 5.0), (9.0, 8.0)]) == []


def test_invalid_parameters_raise():
    with pytest.raises(ValueError):
        plan_chunks([(0.0, 5.0)], max_chunk_s=0)
    with pytest.raises(ValueError):
        plan_chunks([(0.0, 5.0)], max_chunk_s=10.0, overlap_s=10.0)


# --- offset_words ----------------------------------------------------------


def test_offset_shifts_all_timings():
    shifted = offset_words([word("a", 0.0, 0.5), word("b", 0.5, 1.0)], 10.0)
    assert [(w.start, w.end) for w in shifted] == [(10.0, 10.5), (10.5, 11.0)]


def test_offset_preserves_text_and_confidence():
    original = [Word(text="x", start=1.0, end=2.0, confidence=0.9)]
    shifted = offset_words(original, 5.0)
    assert shifted[0].text == "x"
    assert shifted[0].confidence == 0.9


# --- merge_chunks ----------------------------------------------------------


def test_merge_empty():
    assert merge_chunks([]) == []


def test_single_chunk_is_offset_into_absolute_time():
    merged = merge_chunks([(Chunk(30.0, 45.0), [word("hello", 0.5, 1.0)])])
    assert (merged[0].start, merged[0].end) == (30.5, 31.0)


def test_captions_do_not_drift_across_chunks():
    """Regression test for the highest-consequence bug in the pipeline.

    Engines return timings relative to each chunk. If the chunk's own start is
    not added back, every word after the first chunk is early by the chunk
    offset -- and the drift grows with each chunk, so it reads as the model
    getting worse over time rather than as an arithmetic error.
    """
    results = [
        (Chunk(0.0, 20.0), [word("first", 1.0, 1.5)]),
        (Chunk(20.0, 40.0), [word("second", 1.0, 1.5)]),
        (Chunk(40.0, 60.0), [word("third", 1.0, 1.5)]),
    ]
    merged = merge_chunks(results)
    assert [(w.text, w.start) for w in merged] == [
        ("first", 1.0),
        ("second", 21.0),
        ("third", 41.0),
    ]


def test_overlapping_chunks_do_not_duplicate_words():
    """A word in the shared region must appear exactly once."""
    results = [
        (Chunk(0.0, 20.0), [word("alpha", 5.0, 5.4), word("shared", 19.0, 19.4)]),
        (Chunk(18.0, 38.0), [word("shared", 1.0, 1.4), word("omega", 10.0, 10.4)]),
    ]
    merged = merge_chunks(results)
    assert [w.text for w in merged] == ["alpha", "shared", "omega"]
    # Kept from the earlier chunk: 0.0 + 19.0, not 18.0 + 1.0.
    assert merged[1].start == pytest.approx(19.0)


def test_overlap_boundary_keeps_words_on_both_sides():
    """Words either side of the midpoint survive; nothing is swallowed."""
    results = [
        (Chunk(0.0, 20.0), [word("before", 18.4, 18.6)]),
        (Chunk(18.0, 38.0), [word("after", 1.6, 1.8)]),
    ]
    merged = merge_chunks(results)
    # Midpoint of the 18.0-20.0 overlap is 19.0.
    assert [w.text for w in merged] == ["before", "after"]
    assert merged[0].start == pytest.approx(18.4)
    assert merged[1].start == pytest.approx(19.6)


def test_merge_sorts_out_of_order_input():
    results = [
        (Chunk(40.0, 60.0), [word("third", 1.0, 1.5)]),
        (Chunk(0.0, 20.0), [word("first", 1.0, 1.5)]),
        (Chunk(20.0, 40.0), [word("second", 1.0, 1.5)]),
    ]
    assert [w.text for w in merge_chunks(results)] == ["first", "second", "third"]


def test_output_is_monotonic():
    results = [
        (Chunk(0.0, 20.0), [word("a", 1.0, 1.4), word("b", 12.0, 12.4)]),
        (Chunk(18.0, 38.0), [word("c", 5.0, 5.4), word("d", 15.0, 15.4)]),
    ]
    merged = merge_chunks(results)
    for earlier, later in zip(merged, merged[1:]):
        assert earlier.start <= later.start


def test_non_overlapping_chunks_keep_everything():
    results = [
        (Chunk(0.0, 4.0), [word("a", 0.1, 0.5)]),
        (Chunk(10.0, 14.0), [word("b", 0.1, 0.5)]),
    ]
    merged = merge_chunks(results)
    assert [(w.text, w.start) for w in merged] == [("a", 0.1), ("b", 10.1)]


def test_end_to_end_plan_then_merge_covers_a_long_file():
    """Plan chunks for a 90s span, then confirm stitched output is ordered."""
    chunks = plan_chunks([(0.0, 90.0)], max_chunk_s=20.0, overlap_s=2.0)
    # One word per second of each chunk, timed relative to that chunk.
    results = [
        (c, [word(f"w{i}", float(i), float(i) + 0.3) for i in range(int(c.duration))])
        for c in chunks
    ]
    merged = merge_chunks(results)
    assert merged, "expected words"
    for earlier, later in zip(merged, merged[1:]):
        assert earlier.start <= later.start
    assert 0.0 <= merged[0].start < 1.0
    assert merged[-1].start <= 90.0


# --- duplicates at a chunk boundary ------------------------------------------

def test_a_word_reported_twice_across_a_boundary_appears_once():
    """The midpoint split assigns a word by where it STARTS, which is exact
    only while both chunks agree on that time. At a boundary they often do
    not: the same word, heard once with the audio before it and once with the
    audio after it, can be placed tens of milliseconds apart and land either
    side of the midpoint. Both copies survived and the caption read "the the".
    """
    first, second = Chunk(0.0, 20.0), Chunk(18.0, 38.0)   # midpoint 19.0
    words = merge_chunks([
        (first, [Word(text="the", start=18.9, end=19.1)]),
        (second, [Word(text="the", start=1.1, end=1.5)]),   # -> 19.1 absolute
    ])

    assert [w.text for w in words] == ["the"], (
        "the same word survived twice: %r" % [(w.text, w.start) for w in words]
    )


def test_the_longer_span_wins_at_a_boundary():
    """The copy clipped by the chunk edge is the shorter one, and its timing
    is the less trustworthy of the two."""
    first, second = Chunk(0.0, 20.0), Chunk(18.0, 38.0)
    words = merge_chunks([
        (first, [Word(text="the", start=18.9, end=19.1)]),   # 0.2s, clipped
        (second, [Word(text="the", start=1.1, end=1.5)]),    # 0.4s, complete
    ])

    assert len(words) == 1
    assert words[0].end - words[0].start == pytest.approx(0.4)


def test_a_word_genuinely_said_twice_at_a_boundary_survives():
    """The dangerous half of the fix. Removing a real repetition would be a
    worse bug than the duplication it is guarding against, so a repeat with an
    actual gap between the two utterances has to come through intact."""
    first, second = Chunk(0.0, 20.0), Chunk(18.0, 38.0)
    words = merge_chunks([
        (first, [Word(text="very", start=18.6, end=18.8)]),
        (second, [Word(text="very", start=1.0, end=1.2)]),   # -> 19.0, a gap
    ])

    assert [w.text for w in words] == ["very", "very"], (
        "a genuine repetition was swallowed: %r" % [(w.text, w.start) for w in words]
    )


def test_a_repeated_word_away_from_any_overlap_is_never_touched():
    """De-duplication is confined to the overlap windows, where duplication is
    structurally possible. Everywhere else a repeat is the speaker's.

    Deliberately built with TWO overlapping chunks so the de-duplication pass
    actually runs. An earlier version of this test used a single chunk, which
    meant there were no overlap windows at all and the pass returned early --
    so it passed just as happily with the confinement removed, and proved
    nothing about the thing it was named after.
    """
    first, second = Chunk(0.0, 20.0), Chunk(18.0, 38.0)
    words = merge_chunks([
        # Touching repeats at t=5, far from the 18-20 overlap window.
        (first, [Word(text="very", start=5.0, end=5.2),
                 Word(text="very", start=5.2, end=5.4)]),
        (second, [Word(text="later", start=10.0, end=10.4)]),
    ])

    assert [w.text for w in words] == ["very", "very", "later"], (
        "a repetition outside the overlap window was swallowed: %r"
        % [(w.text, w.start) for w in words]
    )


# --- unlag_words -----------------------------------------------------------
#
# Parakeet marks the encoder frame where a word became certain, which is after
# the sound that made it certain, so the whole transcript arrives late.


def test_unlag_shifts_every_word_back():
    out = unlag_words([word("a", 1.0, 1.3), word("b", 1.3, 1.6)], 0.146)
    assert out[0].start == pytest.approx(0.854)
    assert out[1].start == pytest.approx(1.154)


def test_unlag_keeps_each_word_its_own_length():
    # A lag is a shift, not a stretch. Changing durations here would undo the
    # model's only real information about how long a word took.
    words = [word("a", 1.0, 1.3), word("b", 1.3, 1.9)]
    for before, after in zip(words, unlag_words(words, 0.146)):
        assert after.end - after.start == pytest.approx(before.end - before.start)


def test_unlag_clips_at_zero_without_inverting():
    # The first word of a clip that opens on speech has less lag available
    # than we want to remove. It may not start before the file does, and it
    # may certainly not end before it starts.
    out = unlag_words([word("Going", 0.083, 0.417)], 0.146)
    assert out[0].start == 0.0
    assert out[0].end >= out[0].start


def test_unlag_never_reorders():
    words = [word("a", 0.05, 0.2), word("b", 0.2, 0.4), word("c", 0.4, 0.6)]
    out = unlag_words(words, 0.146)
    assert [w.text for w in out] == ["a", "b", "c"]
    assert all(out[i].start <= out[i + 1].start for i in range(len(out) - 1))


def test_unlag_of_zero_changes_nothing():
    words = [word("a", 1.0, 1.3)]
    assert unlag_words(words, 0.0) == words


def test_unlag_puts_measured_words_within_the_encoder_grid():
    """The calibration, checked against the recording it came from.

    Eight words hand-measured against a 23.976 comp, as (reported, true).
    Before: every one late, by 1 to 6 frames. After: inside the 0.08s grid
    the model can answer on, which is as close as its timestamps go.
    """
    frame = 1001 / 24000
    measured = [
        (0.083, 0.0), (0.417, 4 * frame), (0.542, 9 * frame), (0.626, 14 * frame),
        (5.422, 127 * frame), (5.672, 132 * frame),
        (5.839, 136 * frame), (5.923, 138 * frame),
    ]
    words = [word(str(i), rep, rep + 0.2) for i, (rep, _) in enumerate(measured)]
    from app import config

    out = unlag_words(words, config.WORD_LAG_S)
    before = [rep - true for rep, true in measured]
    after = [w.start - true for w, (_, true) in zip(out, measured)]

    assert all(e > 0 for e in before), "the sample should be late throughout"
    assert max(abs(e) for e in after) < 0.11, (
        "worst error %.3fs (%.1f frames)"
        % (max(abs(e) for e in after), max(abs(e) for e in after) / frame)
    )
    assert abs(sum(after) / len(after)) < 0.02, "the bias did not come out"
