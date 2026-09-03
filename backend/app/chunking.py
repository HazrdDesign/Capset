"""Split long audio into model-sized chunks and stitch the results back.

Parakeet caps out around 20-30s of audio per call, so anything longer must be
transcribed in pieces. Each piece comes back with timings relative to its own
start, and the single most consequential bug in a captioning pipeline is
forgetting to shift them back into absolute time -- every caption after the
first chunk then drifts, which looks like poor model accuracy rather than an
arithmetic error.

Everything here is pure: no ASR library, no audio I/O, so it is testable
without a model.
"""

from __future__ import annotations

from .models import Chunk, Word

# Chunk boundaries are placed inside silence where possible. When a single
# speech run is longer than the model limit it must be split mid-speech, and
# the pieces overlap so a word straddling the cut is not lost.
DEFAULT_MAX_CHUNK_S = 20.0
DEFAULT_OVERLAP_S = 2.0


def plan_chunks(
    speech_spans: list[tuple[float, float]],
    max_chunk_s: float = DEFAULT_MAX_CHUNK_S,
    overlap_s: float = DEFAULT_OVERLAP_S,
) -> list[Chunk]:
    """Turn VAD speech spans into chunks no longer than `max_chunk_s`.

    Spans within the limit pass through untouched -- their boundaries already
    sit in silence, which is the cleanest place to cut. Longer spans are
    divided into overlapping windows.
    """
    if max_chunk_s <= 0:
        raise ValueError("max_chunk_s must be positive")
    if not 0 <= overlap_s < max_chunk_s:
        raise ValueError("overlap_s must be >= 0 and < max_chunk_s")

    chunks: list[Chunk] = []
    for start, end in speech_spans:
        if end <= start:
            continue
        if end - start <= max_chunk_s:
            chunks.append(Chunk(start, end))
            continue

        # Advance by (max - overlap) so consecutive windows share `overlap_s`.
        step = max_chunk_s - overlap_s
        cursor = start
        while cursor < end:
            chunk_end = min(cursor + max_chunk_s, end)
            chunks.append(Chunk(cursor, chunk_end))
            if chunk_end >= end:
                break
            cursor += step
    return chunks


def offset_words(words: list[Word], offset: float) -> list[Word]:
    """Shift chunk-relative timings into absolute source time."""
    return [
        Word(
            text=w.text,
            start=w.start + offset,
            end=w.end + offset,
            confidence=w.confidence,
        )
        for w in words
    ]


def merge_chunks(results: list[tuple[Chunk, list[Word]]]) -> list[Word]:
    """Shift each chunk's words into absolute time and stitch them together.

    Where two chunks overlap, the shared region is split at its midpoint:
    words starting before the midpoint are taken from the earlier chunk, words
    starting at or after it from the later one. Cutting at a single point
    means a word cannot be both duplicated and dropped, which a
    keep-the-longer-run heuristic gets wrong at exactly the wrong moments.
    """
    if not results:
        return []

    ordered = sorted(results, key=lambda pair: pair[0].start)
    merged: list[Word] = []
    # Where two chunks overlap, both transcribed the same audio. Recorded so
    # the de-duplication below can be confined to exactly those windows.
    overlaps: list[tuple[float, float]] = []

    for index, (chunk, words) in enumerate(ordered):
        absolute = offset_words(words, chunk.start)

        lower = float("-inf")
        if index > 0:
            previous = ordered[index - 1][0]
            if previous.end > chunk.start:  # overlapping
                lower = (chunk.start + previous.end) / 2.0
                overlaps.append((chunk.start, previous.end))

        upper = float("inf")
        if index + 1 < len(ordered):
            following = ordered[index + 1][0]
            if chunk.end > following.start:  # overlapping
                upper = (following.start + chunk.end) / 2.0

        merged.extend(w for w in absolute if lower <= w.start < upper)

    merged.sort(key=lambda w: (w.start, w.end))
    return _drop_boundary_repeats(merged, overlaps)


def _drop_boundary_repeats(
    words: list[Word], overlaps: list[tuple[float, float]]
) -> list[Word]:
    """Remove a word the midpoint split let through twice.

    Splitting an overlap at its midpoint assigns each word to one chunk by
    where it STARTS, which is exact only while both chunks agree on that time.
    At a boundary they often do not: the same word, recognised once with the
    audio before it and once with the audio after it, can be placed tens of
    milliseconds apart and land either side of the midpoint. Both copies then
    survive and the caption reads "the the".

    Confined to the overlap windows on purpose. A word genuinely said twice
    ("very very good") is not at a chunk boundary in general, and removing it
    would be a worse bug than the one being fixed -- so outside those windows
    nothing is touched at all.
    """
    if not overlaps:
        return words

    def inside_overlap(word: Word) -> bool:
        return any(start <= word.start <= end for start, end in overlaps)

    kept: list[Word] = []
    for word in words:
        if kept:
            previous = kept[-1]
            same_text = previous.text.strip().lower() == word.text.strip().lower()
            # Touching counts: the two copies meet where the split cut them.
            adjacent = word.start <= previous.end + 1e-6
            if same_text and adjacent and inside_overlap(word):
                # Keep the longer span: the copy clipped by the chunk edge is
                # the shorter one, and its timing is the less trustworthy.
                if (word.end - word.start) > (previous.end - previous.start):
                    kept[-1] = word
                continue
        kept.append(word)
    return kept
