"""Reassemble subword tokens into whole words.

Parakeet emits token-level timestamps, not word-level, so words are recovered
by starting a new word wherever a token is marked as beginning one and
appending the unmarked ones that follow.

WHAT MARKS A WORD START depends on who hands us the tokens, and getting it
wrong is silent. SentencePiece itself uses U+2581 (LOWER ONE EIGHTH BLOCK) --
but onnx_asr rewrites it while loading its vocabulary:

    int(id): token.replace("\u2581", " ")          # onnx_asr/asr.py

so the tokens that actually reach us look like " On", " this", " episode,"
with an ordinary LEADING SPACE, and U+2581 never appears at all. Splitting
only on U+2581 therefore never split anything: every token appended to the
one word in progress, each chunk collapsed into a single "word" holding its
whole transcript, and a 30-second podcast came out as "2 words -> 2 captions"
with two enormous captions. Both markers are accepted now.

A word's start is its first token's start; its end is its last token's end.
"""

from __future__ import annotations

from .models import Token, Word

# U+2581, written as an escape rather than the literal glyph: it is visually
# near-identical to an underscore in many fonts, and survives any tool in the
# pipeline that might normalize or mangle it.
WORD_BOUNDARY = "\u2581"


def _split_marker(raw: str) -> tuple[bool, str]:
    """Does this token start a word, and what is its text without the marker?

    Accepts either marker. onnx_asr gives us a leading space; a raw
    SentencePiece vocabulary gives U+2581. Neither is more correct than the
    other -- they are the same information spelled two ways -- so both are
    honoured rather than picking one and hoping.
    """
    if raw.startswith(WORD_BOUNDARY):
        return True, raw[len(WORD_BOUNDARY):]
    if raw[:1].isspace():
        return True, raw.lstrip()
    return False, raw


def _mean(values: list[float]) -> float | None:
    known = [v for v in values if v is not None]
    if not known:
        return None
    return sum(known) / len(known)


def merge_tokens_to_words(tokens: list[Token]) -> list[Word]:
    """Merge subword tokens into words.

    Rules:
      - A token beginning with the boundary marker starts a new word.
      - Any other token is appended to the word in progress.
      - A leading token with no marker still starts a word (engines do not
        always mark the very first token).
      - Tokens that are empty once the marker is stripped are skipped, but a
        marker-only token still terminates the current word.

    Word confidence is the mean of its tokens' confidences, or None if the
    engine reported none.
    """
    words: list[Word] = []

    parts: list[str] = []
    start = 0.0
    end = 0.0
    confs: list[float] = []

    def flush() -> None:
        nonlocal parts, confs
        if parts:
            text = "".join(parts)
            if text:
                words.append(
                    Word(text=text, start=start, end=end, confidence=_mean(confs))
                )
        parts = []
        confs = []

    for token in tokens:
        starts_word, text = _split_marker(token.text)

        if starts_word or not parts:
            flush()
            start = token.start
            end = token.end
            if text:
                parts = [text]
                confs = [token.confidence] if token.confidence is not None else []
            continue

        if text:
            parts.append(text)
            end = token.end
            if token.confidence is not None:
                confs.append(token.confidence)

    flush()
    return words


def words_to_text(words: list[Word]) -> str:
    return " ".join(w.text for w in words)
