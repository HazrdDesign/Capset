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
    // No tolerance. This carried "+8" -- a tenth of the budget, unexplained --
    // which would have let a real overrun through. Measured, the longest
    // caption this produces is 79 characters against a budget of 84, across
    // regular fixtures, realistic prose, 15-character words and a
    // 33-character one. There is nothing for a tolerance to absorb.
    assert.ok(caption.text.length <= budget, `too long: ${caption.text}`);
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


// --- pacing modes -----------------------------------------------------------

/** Evenly spaced words, no meaningful pauses. */
function evenWords(text, step) {
  const gap = step || 0.4;
  return text.split(" ").map((t, i) => ({
    text: t, start: i * gap, end: i * gap + gap * 0.85
  }));
}

const texts = (result) => result.captions.map((c) => c.text);

test("two-word mode puts exactly two words in every full caption", () => {
  const words = evenWords("the quick brown fox jumps over the lazy dog");
  const out = seg.segment(words, { mode: "two" });
  assert.deepStrictEqual(texts(out), [
    "the quick", "brown fox", "jumps over", "the lazy", "dog"
  ]);
});

test("three-word mode groups in threes and keeps the remainder", () => {
  const words = evenWords("one two three four five six seven");
  const out = seg.segment(words, { mode: "three" });
  assert.deepStrictEqual(texts(out), ["one two three", "four five six", "seven"]);
  // The tail must survive: dropping it loses the end of every sentence.
  assert.strictEqual(
    out.captions[out.captions.length - 1].text, "seven",
    "the leftover word was dropped"
  );
});

test("count modes ignore pauses entirely", () => {
  // The whole point of a fixed count is a metronomic rhythm. A pause must
  // NOT split it, or "two words" silently becomes "one or two words".
  const words = [
    { text: "a", start: 0.0, end: 0.2 },
    { text: "b", start: 3.0, end: 3.2 },   // a 2.8s chasm
    { text: "c", start: 3.3, end: 3.5 },
    { text: "d", start: 3.6, end: 3.8 }
  ];
  assert.deepStrictEqual(texts(seg.segment(words, { mode: "two" })),
    ["a b", "c d"]);
});

test("count timings come from the words, not the grouping", () => {
  const words = evenWords("alpha bravo charlie delta");
  const out = seg.segment(words, { mode: "two" });
  assert.strictEqual(out.captions[0].start, words[0].start);
  assert.strictEqual(out.captions[0].end, words[1].end);
  assert.strictEqual(out.captions[1].start, words[2].start);
  assert.strictEqual(out.captions[1].end, words[3].end);
});

test("one and word are the same mode", () => {
  // "word" is the identifier presets saved before the rename use.
  const words = evenWords("keep old presets working");
  assert.deepStrictEqual(
    texts(seg.segment(words, { mode: "one" })),
    texts(seg.segment(words, { mode: "word" }))
  );
});

test("smart parts never emits a caption below two words on hesitation", () => {
  // A short pause after the first word used to produce a one-word caption,
  // degrading the mode into word-by-word on exactly the hesitant delivery
  // where pauses are most common.
  const words = [
    { text: "So", start: 0.0, end: 0.30 },
    { text: "anyway", start: 0.85, end: 1.20 },   // 0.55s — above maxGapS
    { text: "I", start: 1.25, end: 1.35 },
    { text: "went", start: 1.40, end: 1.70 },
    { text: "home", start: 1.75, end: 2.10 }
  ];
  const out = seg.segment(words, { mode: "parts" });
  out.captions.forEach((c) => {
    assert.ok(c.words.length >= 2,
      "emitted a " + c.words.length + "-word caption: " + JSON.stringify(c.text));
  });
});

test("smart parts holds captions to at most five words", () => {
  const words = evenWords("one two three four five six seven eight nine ten", 0.25);
  seg.segment(words, { mode: "parts" }).captions.forEach((c) => {
    assert.ok(c.words.length <= 5, "emitted " + c.words.length + " words");
  });
});

test("a real stop still breaks smart parts below the floor", () => {
  // The floor must not glue the start of a new thought onto the end of the
  // old one. A pause this long is punctuation, not hesitation.
  const words = [
    { text: "Yeah", start: 0.0, end: 0.30 },
    { text: "So", start: 1.60, end: 1.80 },       // 1.30s — a full stop
    { text: "I", start: 1.85, end: 1.95 },
    { text: "went", start: 2.00, end: 2.30 },
    { text: "home", start: 2.35, end: 2.70 }
  ];
  assert.deepStrictEqual(
    texts(seg.segment(words, { mode: "parts" })),
    ["Yeah", "So I went home"]
  );
});

test("sentence mode splits only on punctuation", () => {
  const words = evenWords("I went to the store. It was closed. So I left.");
  assert.deepStrictEqual(
    texts(seg.segment(words, { mode: "sentence" })),
    ["I went to the store.", "It was closed.", "So I left."]
  );
});

test("sentence mode ignores the line budget when cutting", () => {
  // A long sentence stays ONE caption — it wraps for display, it does not
  // get cut. Phrase mode would break this into several.
  const long = "this is a deliberately long sentence that runs well past " +
               "forty two characters and keeps going for a while yet.";
  const words = evenWords(long, 0.2);
  const out = seg.segment(words, { mode: "sentence" });
  assert.strictEqual(out.captions.length, 1, texts(out).join(" | "));
  assert.ok(out.captions[0].lines.length > 1, "a long caption should wrap");
  assert.ok(
    seg.segment(words, { mode: "phrase" }).captions.length > 1,
    "phrase mode should still cut it — otherwise this proves nothing"
  );
});

test("sentence mode still caps runaway unpunctuated speech", () => {
  // ASR punctuation is imperfect. Without a duration cap a speaker who never
  // lands a full stop produces one caption spanning the whole clip.
  const words = evenWords(
    "and then and then and then and then and then and then and then and then", 1.0
  );
  const out = seg.segment(words, { mode: "sentence" });
  assert.ok(out.captions.length > 1, "no cap applied: " + texts(out).join(" | "));
  out.captions.forEach((c) => {
    assert.ok(c.end - c.start <= seg.SENTENCE_DEFAULTS.maxDurationS + 1.0);
  });
});
