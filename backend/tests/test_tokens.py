"""Tests for BPE token -> word reassembly."""

import pytest

from app.models import Token
from app.tokens import WORD_BOUNDARY as B
from app.tokens import merge_tokens_to_words, words_to_text


def tok(text, start, end, conf=None):
    return Token(text=text, start=start, end=end, confidence=conf)


def test_empty_input():
    assert merge_tokens_to_words([]) == []


def test_single_marked_token():
    words = merge_tokens_to_words([tok(f"{B}hello", 0.1, 0.5)])
    assert [(w.text, w.start, w.end) for w in words] == [("hello", 0.1, 0.5)]


def test_subwords_merge_into_one_word():
    """A word split across pieces spans from the first start to the last end."""
    words = merge_tokens_to_words(
        [tok(f"{B}extra", 1.0, 1.2), tok("ord", 1.2, 1.35), tok("inary", 1.35, 1.6)]
    )
    assert [(w.text, w.start, w.end) for w in words] == [("extraordinary", 1.0, 1.6)]


def test_first_token_without_marker_still_starts_a_word():
    """Engines do not reliably mark the very first token."""
    words = merge_tokens_to_words([tok("hello", 0.0, 0.4), tok(f"{B}world", 0.5, 0.9)])
    assert [w.text for w in words] == ["hello", "world"]


def test_multiple_words():
    words = merge_tokens_to_words(
        [
            tok(f"{B}the", 0.0, 0.2),
            tok(f"{B}quick", 0.2, 0.6),
            tok(f"{B}brown", 0.6, 1.0),
            tok("ish", 1.0, 1.1),
        ]
    )
    assert [w.text for w in words] == ["the", "quick", "brownish"]
    assert words[-1].start == 0.6 and words[-1].end == 1.1


def test_punctuation_attaches_to_preceding_word():
    words = merge_tokens_to_words(
        [tok(f"{B}hello", 0.0, 0.4), tok(",", 0.4, 0.41), tok(f"{B}world", 0.5, 0.9)]
    )
    assert [w.text for w in words] == ["hello,", "world"]


def test_marker_only_token_does_not_emit_empty_word():
    words = merge_tokens_to_words(
        [tok(f"{B}hi", 0.0, 0.3), tok(B, 0.3, 0.31), tok(f"{B}there", 0.4, 0.8)]
    )
    assert [w.text for w in words] == ["hi", "there"]


def test_confidence_is_averaged_across_tokens():
    words = merge_tokens_to_words(
        [tok(f"{B}ab", 0.0, 0.1, 1.0), tok("cd", 0.1, 0.2, 0.5)]
    )
    assert words[0].confidence == pytest.approx(0.75)


def test_confidence_is_none_when_engine_reports_none():
    words = merge_tokens_to_words([tok(f"{B}ab", 0.0, 0.1)])
    assert words[0].confidence is None


def test_timings_are_non_decreasing():
    """Downstream caption timing assumes words arrive in order."""
    words = merge_tokens_to_words(
        [tok(f"{B}a", 0.0, 0.2), tok(f"{B}b", 0.2, 0.5), tok(f"{B}c", 0.5, 0.9)]
    )
    for earlier, later in zip(words, words[1:]):
        assert earlier.start <= later.start
        assert earlier.end <= later.end


def test_words_to_text():
    words = merge_tokens_to_words(
        [tok(f"{B}hello", 0.0, 0.4), tok(f"{B}world", 0.5, 0.9)]
    )
    assert words_to_text(words) == "hello world"
