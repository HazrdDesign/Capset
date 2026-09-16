"""Reading what the speech model actually returns.

This is the seam where our code meets onnx-asr's data, and it had no tests at
all. The engine's own fake (FakeEngine in test_transcribe.py) hands back
finished Token objects, so it skips _tokens_from_result entirely -- the one
function that has to be right about somebody else's shape was the one function
nothing executed.

What shipped in v0.2.x-v0.3.0: `timestamps` is a list of plain floats, and the
parser iterated it treating each entry as an object with `.text`/`.start`.
Floats have neither, so every token came out `("", 0.0, 0.0)`,
merge_tokens_to_words dropped them all, and a perfectly good transcript became
"0 words -> 0 captions". The transcript was sitting in `result.text` the whole
time.

So these tests build results in the REAL shape, and the last test pins that
shape against the installed library so this stand-in cannot drift.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pytest

from app.engines.base import EngineUnavailable
from app.engines.onnx_asr_engine import _tokens_from_result
from app.tokens import merge_tokens_to_words


@dataclass
class Result:
    """Mirrors onnx_asr.asr.TimestampedResult. Pinned by the test below."""

    text: str
    timestamps: list[float] | None = None
    tokens: list[str] | None = None
    logprobs: list[float] | None = None


def test_a_real_result_becomes_the_words_the_model_found():
    # "▁" (U+2581) is SentencePiece's word-boundary marker, which is what
    # tokens.py splits on. These are the pieces the model actually emits.
    result = Result(
        text="so anyway I went home",
        tokens=["▁so", "▁any", "way", "▁I", "▁went", "▁home"],
        timestamps=[0.08, 0.24, 0.40, 0.56, 0.72, 0.96],
    )
    words = merge_tokens_to_words(_tokens_from_result(result, duration=1.2))
    assert [w.text for w in words] == ["so", "anyway", "I", "went", "home"]


def test_the_old_reading_produced_nothing_from_this_exact_input():
    """Pins the bug, so a regression cannot pass quietly.

    Reproduces what the previous parser did to the same result: ask each
    float for `.text` and `.start`.
    """
    result = Result(
        text="so anyway",
        tokens=["▁so", "▁any", "way"],
        timestamps=[0.08, 0.24, 0.40],
    )
    old_style = [
        (getattr(item, "text", ""), float(getattr(item, "start", 0.0)))
        for item in result.timestamps
    ]
    assert old_style == [("", 0.0)] * 3, "the old parser read floats as objects"
    assert [w.text for w in merge_tokens_to_words(_tokens_from_result(result, 0.5))]


def test_a_token_is_bounded_by_how_long_it_could_be_spoken():
    """Tokens used to end where the next one starts, and that is an assumption.

    It says the speaker never stops: whatever silence follows a word is
    charged to the word. A transcript built that way has a gap of exactly zero
    between every pair of words -- all 54 of them, in the one this was checked
    against -- so every pause rule downstream measured a constant.

    0.50 - 0.10 is 0.40s, which is too long for "a" to have been said for. The
    token takes what it plausibly used and the rest becomes silence.
    """
    result = Result(
        text="a b c",
        tokens=["▁a", "▁b", "▁c"],
        timestamps=[0.10, 0.50, 1.10],
    )
    tokens = _tokens_from_result(result, duration=1.4)
    assert [t.start for t in tokens] == [0.10, 0.50, 1.10]
    assert [round(t.end, 3) for t in tokens] == [0.30, 0.70, 1.40]
    for token in tokens:
        assert token.end > token.start, "a token with no duration times nothing"


def test_the_silence_between_words_survives_to_the_caller():
    """The whole point: a gap that is actually there can be measured."""
    result = Result(
        text="pause here",
        tokens=["▁pause", "▁here"],
        timestamps=[0.00, 1.00],
    )
    tokens = _tokens_from_result(result, duration=1.5)
    gap = tokens[1].start - tokens[0].end
    assert gap > 0.5, "a full second between two words reported as %.2fs" % gap


def test_words_spoken_back_to_back_leave_no_gap():
    """And the other half: silence is not invented where there is none."""
    result = Result(
        text="quick quick",
        tokens=["▁quick", "▁quick"],
        timestamps=[0.00, 0.10],
    )
    tokens = _tokens_from_result(result, duration=0.3)
    assert tokens[1].start - tokens[0].end == pytest.approx(0.0)


def test_the_last_token_is_not_stretched_across_a_music_tail():
    """The six-second caption.

    Chunks are planned from VAD speech spans, and the energy gate holds a span
    open through background music -- so a chunk ends long after the last word
    in it was spoken. Taking the final token's end from the chunk's duration
    handed that whole tail to one word: it sat on screen for the length of the
    music, and the panel's phrase grouping, seeing a caption whose span blew
    the duration budget, stranded it on a layer of its own.

    The chunk's duration bounds the token. It does not measure it.
    """
    result = Result(
        text="that is the end",
        tokens=["▁that", "▁is", "▁the", "▁end"],
        timestamps=[8.00, 8.30, 8.60, 8.90],
    )
    # Six seconds of music after the last word.
    tokens = _tokens_from_result(result, duration=15.0)
    last = tokens[-1]
    assert last.end - last.start <= 0.6, "the final word swallowed the music tail"
    # ...while the tokens that DO have a following token keep their real ends.
    # Bounded by how long each could have been spoken, not by the next start.
    assert [round(t.end, 3) for t in tokens[:-1]] == [8.20, 8.50, 8.80]


def test_a_short_chunk_still_ends_its_last_token_at_the_chunk_edge():
    """The clamp is a ceiling, not a fixed length.

    When the chunk really does end just after the last word -- the common case
    for a span cut in silence -- that end is real information and is kept.
    """
    result = Result(text="hello", tokens=["▁hello"], timestamps=[0.20])
    (token,) = _tokens_from_result(result, duration=0.45)
    assert token.end == pytest.approx(0.45)


def test_the_last_token_is_bounded_even_without_a_chunk_duration():
    result = Result(text="hi", tokens=["▁hi"], timestamps=[0.4])
    (token,) = _tokens_from_result(result, duration=0.0)
    assert token.end > token.start


def test_confidence_is_a_probability_not_a_log():
    # logprobs are <= 0. Passed through raw, a token the model was 73% sure of
    # would be reported with "confidence" -0.31.
    result = Result(
        text="yes",
        tokens=["▁yes"],
        timestamps=[0.0],
        logprobs=[math.log(0.73)],
    )
    (token,) = _tokens_from_result(result, duration=1.0)
    assert token.confidence == pytest.approx(0.73)
    assert 0.0 <= token.confidence <= 1.0


def test_text_without_timestamps_raises_instead_of_looking_like_silence():
    """The failure mode that hid this bug for three releases.

    Returning [] here is indistinguishable from "there was no speech", so the
    user is sent to check their audio for a problem that is ours.
    """
    result = Result(text="there is definitely speech here", timestamps=None, tokens=None)
    with pytest.raises(EngineUnavailable, match="no timestamps"):
        _tokens_from_result(result, duration=3.0)


def test_genuinely_empty_audio_is_not_an_error():
    assert _tokens_from_result(Result(text="", timestamps=None, tokens=None), 1.0) == []
    assert _tokens_from_result(Result(text="   ", timestamps=None, tokens=None), 1.0) == []


def test_mismatched_lengths_pair_what_they_can(caplog):
    result = Result(
        text="a b",
        tokens=["▁a", "▁b", "▁c"],
        timestamps=[0.1, 0.2],
    )
    with caplog.at_level("WARNING"):
        tokens = _tokens_from_result(result, duration=1.0)
    assert len(tokens) == 2
    assert "3 token(s) and 2 timestamp(s)" in caplog.text, (
        "a mismatch must be visible; silently dropping tokens is the class of "
        "bug this file exists for"
    )


def test_our_stand_in_matches_the_real_library():
    """The guard that stops this file drifting from onnx-asr.

    Every test above is only meaningful if `Result` still describes what the
    library returns. Skipped where onnx_asr cannot be imported (it needs
    onnxruntime), which is why it is a pin and not the only defence.
    """
    asr = pytest.importorskip(
        "onnx_asr.asr", reason="onnx-asr not importable without onnxruntime"
    )
    real = asr.TimestampedResult.__dataclass_fields__
    assert set(real) == set(Result.__dataclass_fields__), (
        "onnx_asr.TimestampedResult has changed shape; update Result and the "
        "parser together"
    )
    assert list(real) == ["text", "timestamps", "tokens", "logprobs"]
