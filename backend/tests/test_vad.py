"""Tests for speech detection.

This file had NO coverage, which is how a bug that silently discarded 97% of
the dialogue reached a release. The gate's failure mode is not a crash — it
returns a plausible-looking span and the job reports success — so the only
thing that catches it is asserting on what it keeps.
"""

import logging

import numpy as np
import pytest

from app.vad import MIN_ENERGY_RETAINED, _energy_spans, detect_speech

SR = 16_000


@pytest.fixture(autouse=True)
def quiet_logs():
    logging.disable(logging.CRITICAL)
    yield
    logging.disable(logging.NOTSET)


def noise(seconds, level=0.08, seed=0):
    rng = np.random.default_rng(seed)
    return (level * rng.standard_normal(int(seconds * SR))).astype(np.float32)


def detected(audio):
    return sum(end - start for start, end in detect_speech(audio, SR))


# --- the regression that shipped -----------------------------------------

def test_one_loud_transient_does_not_capture_the_file():
    """The v0.1.8 bug: a door close became the only "speech" in an 11s clip.

    The old threshold keyed off max(rms), so a single 30ms spike lifted it
    above ordinary speech. 11.00s of dialogue detected as 0.36s.
    """
    speech = noise(11.0)
    with_bump = speech.copy()
    start = int(5.0 * SR)
    with_bump[start:start + int(0.03 * SR)] = 0.9

    kept = detected(with_bump)
    assert kept > 10.0, (
        f"only {kept:.2f}s of 11.00s survived — a transient is capturing the "
        "gate again"
    )


@pytest.mark.parametrize("amplitude", [0.5, 0.9, 1.0])
@pytest.mark.parametrize("position", [0.1, 0.5, 0.9])
def test_transients_anywhere_at_any_level_are_survivable(amplitude, position):
    """Not just the one case that was reported."""
    speech = noise(8.0)
    audio = speech.copy()
    start = int(position * 7.5 * SR)
    audio[start:start + int(0.03 * SR)] = amplitude
    assert detected(audio) > 7.0


def test_several_transients_still_do_not_capture_the_file():
    speech = noise(10.0)
    audio = speech.copy()
    for t in (1.0, 3.5, 6.0, 8.5):
        start = int(t * SR)
        audio[start:start + int(0.02 * SR)] = 0.95
    assert detected(audio) > 9.0


# --- it must still do its job --------------------------------------------

def test_real_silence_is_still_skipped():
    """A gate that never cuts anything is useless, not merely safe."""
    audio = np.zeros(int(20 * SR), dtype=np.float32)
    audio[int(2 * SR):int(5 * SR)] = noise(3.0, seed=1)
    audio[int(12 * SR):int(15 * SR)] = noise(3.0, seed=2)

    kept = detected(audio)
    assert kept < 12.0, "should skip the long silences"
    assert kept > 5.0, "should keep both speech regions"


def test_speech_regions_are_found_where_they_actually_are():
    audio = np.zeros(int(15 * SR), dtype=np.float32)
    audio[int(4 * SR):int(7 * SR)] = noise(3.0, seed=3)

    spans = detect_speech(audio, SR)
    assert spans, "should find the speech"
    start = min(s for s, _ in spans)
    end = max(e for _, e in spans)
    # Padding widens the span slightly; it must not wander.
    assert 3.5 < start < 4.5, f"span starts at {start:.2f}, expected near 4.0"
    assert 6.5 < end < 7.5, f"span ends at {end:.2f}, expected near 7.0"


# --- falling back is always safe -----------------------------------------

def test_continuous_speech_falls_back_to_the_whole_file():
    """No silence to cut, so cutting nothing is the correct answer."""
    assert detected(noise(11.0)) == pytest.approx(11.0, abs=0.1)


def test_the_energy_gate_finds_no_speech_in_silence():
    """The gate's own answer, which is the part with content.

    This replaces an assertion that could not fail: it checked that the total
    detected duration of a 5-second file was <= 5 seconds. detect_speech can
    only return [] (total 0) or the whole file (total 5.0), so every possible
    implementation passed. The name claimed the opposite of the behaviour, too
    -- silence IS reported as one whole-file span, deliberately.
    """
    assert _energy_spans(np.zeros(int(5 * SR), dtype=np.float32), SR) == []


def test_silence_falls_back_to_the_whole_file():
    """The deliberate design, stated so a change to it is a visible decision.

    detect_speech never returns nothing: when the gate finds no speech the
    whole file is transcribed instead. Losing speech costs the user their
    work, and transcribing silence costs a few seconds -- so the fallback is
    the safe direction, and the backend now rejects genuinely silent audio
    before it reaches here anyway.
    """
    spans = detect_speech(np.zeros(int(5 * SR), dtype=np.float32), SR)
    assert spans == [(0.0, 5.0)]


def test_empty_input_does_not_raise():
    assert detect_speech(np.zeros(0, dtype=np.float32), SR) == []


def test_very_short_input_does_not_raise():
    assert isinstance(detect_speech(noise(0.01), SR), list)


def test_quiet_recording_is_not_discarded():
    """Low-level audio is still speech; normalise expectations, not the file."""
    quiet = noise(8.0, level=0.005)
    assert detected(quiet) > 7.0


def test_loud_recording_is_handled():
    assert detected(noise(8.0, level=0.4)) > 7.0


# --- the guard itself ------------------------------------------------------

def test_energy_retention_threshold_is_strict():
    """Documents the safety margin; a lax value would let the bug back in."""
    assert MIN_ENERGY_RETAINED >= 0.85


def test_spans_are_ordered_and_within_the_file():
    audio = np.zeros(int(30 * SR), dtype=np.float32)
    for start in (2, 10, 20):
        audio[int(start * SR):int((start + 2) * SR)] = noise(2.0, seed=start)

    spans = detect_speech(audio, SR)
    for start, end in spans:
        assert 0 <= start < end <= 30.0
    for (_, prev_end), (next_start, _) in zip(spans, spans[1:]):
        assert next_start >= prev_end, "spans must not overlap"
