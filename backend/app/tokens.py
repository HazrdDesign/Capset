"""Reassemble SentencePiece BPE tokens into whole words.

Parakeet emits token-level timestamps, not word-level. SentencePiece marks
the start of a word with U+2581 (LOWER ONE EIGHTH BLOCK), so words are
recovered by starting a new word at each marked token and appending the
unmarked ones that follow.

A word's start is its first token's start; its end is its last token's end.
"""

from __future__ import annotations

from .models import Token, Word

# U+2581. Written as an escape rather than the literal glyph: it is visually
# near-identical to an underscore in many fonts, and survives any tool in the
# pipeline that might normalize or mangle it.
WORD_BOUNDARY = "\u2581"


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
        raw = token.text
        starts_word = raw.startswith(WORD_BOUNDARY)
        text = raw[len(WORD_BOUNDARY):] if starts_word else raw

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
