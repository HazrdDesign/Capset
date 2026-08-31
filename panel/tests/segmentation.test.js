const test = require("node:test");
const assert = require("node:assert");
const seg = require("../js/lib/segmentation.js");

/** Evenly spaced words, `gap` seconds apart. */
function words(texts, { start = 0, dur = 0.3, gap = 0.05 } = {}) {
  let t = start;
  return texts.map((text) => {
    const w = { text, start: t, end: t + dur, confidence: 0.9 };
    t += dur + gap;
    return w;
  });
}

const SENTENCE = words("the quick brown fox jumps over the lazy dog".split(" "));

// --- layout ---------------------------------------------------------------

test("orientation is chosen by aspect ratio, not resolution", () => {
  assert.strictEqual(seg.chooseLayout(1080, 1920).orientation, "vertical");
  assert.strictEqual(seg.chooseLayout(1920, 1080).orientation, "horizontal");
  assert.strictEqual(seg.chooseLayout(1080, 1080).orientation, "square");
  // Same pixel count, opposite shapes.
  assert.notStrictEqual(
    seg.chooseLayout(1080, 1920).options.maxWords,
    seg.chooseLayout(1920, 1080).options.maxWords
  );
});

test("vertical captions are shorter than horizontal ones", () => {
  const v = seg.chooseLayout(1080, 1920).options;
  const h = seg.chooseLayout(1920, 1080).options;
  assert.ok(v.maxCharsPerLine < h.maxCharsPerLine);
  assert.ok(v.maxWords < h.maxWords);
});

test("missing comp size falls back to broadcast defaults", () => {
  const layout = seg.chooseLayout(0, 0);
  assert.strictEqual(layout.orientation, "unknown");
  assert.strictEqual(layout.options.maxCharsPerLine, 42);
});

test("layout carries a rationale for the UI", () => {
  assert.match(seg.chooseLayout(1080, 1920).rationale, /Vertical/);
});

// --- wrapping -------------------------------------------------------------

test("short text stays on one line", () => {
  assert.deepStrictEqual(seg.wrapLines("hello world", 42, 2), ["hello world"]);
});

test("wrapping respects the character budget", () => {
  const lines = seg.wrapLines("the quick brown fox jumps over the lazy dog", 20, 2);
  assert.ok(lines.length <= 2);
  assert.ok(lines[0].length <= 20, `first line too long: ${lines[0]}`);
});

test("overflow past maxLines is kept, never silently dropped", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve";
  const lines = seg.wrapLines(text, 10, 2);
  assert.ok(lines.length <= 2);
  const joined = lines.join(" ").split(/\s+/).sort();
  assert.deepStrictEqual(joined, text.split(" ").sort(), "words were lost");
});

test("a single word longer than the budget does not loop forever", () => {
  const lines = seg.wrapLines("supercalifragilisticexpialidocious", 10, 2);
  assert.ok(lines.length >= 1);
  assert.ok(lines.join("").includes("supercalifragilistic"));
});

// --- word mode ------------------------------------------------------------

test("word mode emits one caption per word with its own timing", () => {
  const out = seg.segment(SENTENCE, { mode: "word" });
  assert.strictEqual(out.captions.length, SENTENCE.length);
  assert.strictEqual(out.captions[0].text, "the");
  assert.strictEqual(out.captions[0].start, SENTENCE[0].start);
  assert.strictEqual(out.captions[0].end, SENTENCE[0].end);
});

// --- phrase mode ----------------------------------------------------------

test("phrase mode groups words", () => {
  const out = seg.segment(SENTENCE, { mode: "phrase" });
  assert.ok(out.captions.length < SENTENCE.length);
  assert.ok(out.captions.length >= 1);
});

test("a long pause forces a caption break", () => {
  const list = [
    ...words(["hello", "there"]),
    ...words(["much", "later"], { start: 20 })
  ];
  const out = seg.segment(list, { mode: "phrase" });
  assert.ok(out.captions.length >= 2, "the 20s gap should split the caption");
  assert.ok(out.captions[0].text.includes("hello"));
});

test("sentence-ending punctuation closes a caption", () => {
  const list = words(["Hello", "world.", "Next", "sentence"]);
  const out = seg.segment(list, { mode: "phrase" });
  assert.ok(out.captions.length >= 2);
  assert.ok(out.captions[0].text.endsWith("world."));
});

test("captions never exceed the character budget", () => {
  const many = words(new Array(60).fill("word"));
  const out = seg.segment(many, { mode: "phrase" });
  const budget = seg.PHRASE_DEFAULTS.maxCharsPerLine * seg.PHRASE_DEFAULTS.maxLines;
  for (const caption of out.captions) {
    assert.ok(caption.text.length <= budget + 8, `too long: ${caption.text}`);
  }
});

test("captions never exceed the word budget", () => {
  const many = words(new Array(60).fill("a"));
  const out = seg.segment(many, { mode: "phrase" });
  for (const caption of out.captions) {
    assert.ok(caption.words.length <= seg.PHRASE_DEFAULTS.maxWords);
  }
});

test("no word is lost or duplicated during grouping", () => {
  const out = seg.segment(SENTENCE, { mode: "phrase" });
  const flat = out.captions.flatMap((c) => c.words.map((w) => w.text));
  assert.deepStrictEqual(flat, SENTENCE.map((w) => w.text));
});

test("caption timings come from their first and last words", () => {
  const out = seg.segment(SENTENCE, { mode: "phrase" });
  for (const caption of out.captions) {
    assert.strictEqual(caption.start, caption.words[0].start);
    assert.strictEqual(caption.end, caption.words[caption.words.length - 1].end);
    assert.ok(caption.end > caption.start);
  }
});

test("captions are ordered and do not overlap", () => {
  const out = seg.segment(SENTENCE, { mode: "phrase" });
  for (let i = 1; i < out.captions.length; i++) {
    assert.ok(out.captions[i].start >= out.captions[i - 1].start);
    assert.ok(out.captions[i].start >= out.captions[i - 1].end - 1e-9);
  }
});

// --- smart mode -----------------------------------------------------------

test("smart mode yields shorter captions on a vertical comp", () => {
  const vertical = seg.segment(SENTENCE, { mode: "smart", width: 1080, height: 1920 });
  const horizontal = seg.segment(SENTENCE, { mode: "smart", width: 1920, height: 1080 });
  assert.ok(
    vertical.captions.length > horizontal.captions.length,
    "vertical should break the same words into more, smaller captions"
  );
});

test("smart mode reports the layout it chose", () => {
  const out = seg.segment(SENTENCE, { mode: "smart", width: 1080, height: 1920 });
  assert.strictEqual(out.layout.orientation, "vertical");
  assert.ok(out.layout.rationale.length > 0);
});

test("explicit options override the smart layout", () => {
  const out = seg.segment(SENTENCE, {
    mode: "smart", width: 1080, height: 1920, options: { maxWords: 99, maxGapS: 99 }
  });
  assert.ok(out.captions.length <= 2);
});

// --- edges ----------------------------------------------------------------

test("empty input yields no captions in every mode", () => {
  for (const mode of ["word", "phrase", "smart"]) {
    assert.deepStrictEqual(seg.segment([], { mode, width: 1920, height: 1080 }).captions, []);
  }
  assert.deepStrictEqual(seg.segment(null, { mode: "phrase" }).captions, []);
});

test("a single word works in every mode", () => {
  const one = words(["solo"]);
  for (const mode of ["word", "phrase", "smart"]) {
    const out = seg.segment(one, { mode, width: 1920, height: 1080 });
    assert.strictEqual(out.captions.length, 1);
    assert.strictEqual(out.captions[0].text, "solo");
  }
});

test("unknown mode falls back to phrase", () => {
  const out = seg.segment(SENTENCE, { mode: "nonsense" });
  assert.strictEqual(out.mode, "phrase");
});

test("reading speed flags captions that are too fast to read", () => {
  const fast = { text: "a".repeat(60), start: 0, end: 1, words: [], lines: [] };
  const ok = { text: "short", start: 0, end: 2, words: [], lines: [] };
  assert.ok(seg.readingSpeed(fast) > 20, "should exceed the 20 CPS guideline");
  assert.ok(seg.readingSpeed(ok) < 20);
});
