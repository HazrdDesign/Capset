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

test("word mode emits one caption per word, starting on that word", () => {
  const out = seg.segment(SENTENCE, { mode: "word" });
  assert.strictEqual(out.captions.length, SENTENCE.length);
  assert.strictEqual(out.captions[0].text, "the");
  assert.strictEqual(out.captions[0].start, SENTENCE[0].start);
  // The START is the word's, exactly. The END is held to the next caption
  // rather than blinking off for the 0.05s between words -- see hold().
  assert.strictEqual(out.captions[0].end, out.captions[1].start);
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

test("caption timings come from their words, with the end held", () => {
  const out = seg.segment(SENTENCE, { mode: "phrase" });
  for (const caption of out.captions) {
    assert.strictEqual(caption.start, caption.words[0].start);
    // The end is the last word's, held on (see hold()) -- never before it,
    // which would clear the caption while it is still being spoken.
    const spoken = caption.words[caption.words.length - 1].end;
    assert.ok(caption.end >= spoken, "cleared before its last word finished");
    assert.ok(caption.end <= spoken + seg.MAX_HOLD_S + 1e-9,
      "held " + (caption.end - spoken).toFixed(2) + "s past the speech");
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

test("count captions start on their words, not on the grouping", () => {
  const words = evenWords("alpha bravo charlie delta");
  const out = seg.segment(words, { mode: "two" });
  assert.strictEqual(out.captions[0].start, words[0].start);
  assert.strictEqual(out.captions[1].start, words[2].start);
  // Ends are held (see hold()), so they are the next caption's start rather
  // than the last word's end -- the one place the two differ.
  assert.strictEqual(out.captions[0].end, words[1].end + (words[2].start - words[1].end));
  assert.strictEqual(out.captions[0].end, out.captions[1].start);
  assert.ok(out.captions[1].end >= words[3].end, "the last caption was cut short");
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
    // The cap governs how much SPEECH goes in a caption. What hold() adds
    // after the last word is a separate decision, measured separately.
    const spoken = c.words[c.words.length - 1].end - c.words[0].start;
    assert.ok(spoken <= seg.SENTENCE_DEFAULTS.maxDurationS + 1.0);
  });
});


test("smart never emits a one-word caption mid-sentence", () => {
  // Smart absorbed the old "smart parts" bounds. Without a floor, a short
  // hesitation after the first word cuts there and the mode degrades into
  // word-by-word on exactly the hesitant delivery where pauses are common.
  const w = [
    { text: "So", start: 0.0, end: 0.30 },
    { text: "anyway", start: 0.85, end: 1.20 },   // 0.55s pause
    { text: "I", start: 1.25, end: 1.35 },
    { text: "went", start: 1.40, end: 1.70 },
    { text: "home", start: 1.75, end: 2.10 }
  ];
  const out = seg.segment(w, { mode: "smart", width: 1080, height: 1920 });
  // The last caption is NOT exempt. It used to be -- "the words simply ran
  // out" was treated as a good enough reason for a one-word tail -- but from
  // the timeline it looks identical to any other bad cut, because it is one.
  // rebalance() moves the break back instead.
  out.captions.forEach((c) => assert.ok(c.words.length >= 2,
    "one-word caption mid-sentence: " + JSON.stringify(c.text)));
  assert.ok(out.captions.length >= 2, "nothing was split at all");
});

test("smart still sizes itself to the comp", () => {
  // The other half of what it merged: a vertical comp gets punchier captions
  // than a horizontal one from the same words.
  const words = evenWords(
    "there is quite a lot of speech here to divide up between the two shapes", 0.28
  );
  const tall = seg.segment(words, { mode: "smart", width: 1080, height: 1920 });
  const wide = seg.segment(words, { mode: "smart", width: 1920, height: 1080 });
  assert.ok(tall.captions.length > wide.captions.length,
    "vertical " + tall.captions.length + " vs horizontal " + wide.captions.length);
});

test("the retired modes still resolve for old presets", () => {
  // They are gone from the dropdown, not from the code: a preset saved by an
  // earlier version can still name one.
  const words = evenWords("one two three four five six");
  ["two", "parts", "sentence", "phrase", "word"].forEach((mode) => {
    const out = seg.segment(words, { mode, width: 1080, height: 1920 });
    assert.ok(out.captions.length > 0, mode + " produced nothing");
  });
});


// --- stranded tails ---------------------------------------------------------

test("smart does not strand the last word of a run", () => {
  // The reported symptom, exactly: five evenly-spoken words against a
  // four-word budget put "this." on a layer of its own. Nothing in the
  // delivery cut there -- the caption filled up and the leftover became a
  // caption by default.
  const out = seg.segment(evenWords("I really enjoyed making this.", 0.35),
    { mode: "smart", width: 1080, height: 1920 });
  assert.deepStrictEqual(texts(out), ["I really enjoyed", "making this."]);
});

test("a pause before the last word still gets its own caption", () => {
  // The repair must not swallow a break the speaker actually made, or it
  // trades one wrong cut for another.
  const w = [
    { text: "and", start: 0.00, end: 0.25 },
    { text: "that", start: 0.30, end: 0.55 },
    { text: "was", start: 0.60, end: 0.85 },
    { text: "that", start: 0.90, end: 1.20 },
    { text: "honestly", start: 2.60, end: 3.10 }   // 1.4s — a real stop
  ];
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "smart", width: 1080, height: 1920 })),
    ["and that was that", "honestly"]
  );
});

test("a full stop before a short caption stays where the speaker put it", () => {
  // The caption before has a word to spare here, so the guard is the only
  // thing stopping the cut moving: without it the end of one sentence is
  // glued to the start of the next as "I went" / "home. Anyway".
  const w = [
    { text: "I", start: 0.00, end: 0.20 },
    { text: "went", start: 0.25, end: 0.50 },
    { text: "home.", start: 0.55, end: 0.90 },
    { text: "Anyway", start: 0.95, end: 1.40 }
  ];
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "smart", width: 1080, height: 1920 })),
    ["I went home.", "Anyway"]
  );
});

test("a caption already at the floor is not broken to fix the one after", () => {
  // Two long words are cut apart by the duration cap, leaving "welcome" on
  // its own. The caption before is AT the floor, so taking a word back would
  // simply move the problem onto it -- and the cap that split them forbids
  // joining them anyway. A short caption is the right answer here.
  const w = [
    { text: "Hello", start: 0.00, end: 1.20 },
    { text: "everybody", start: 1.30, end: 2.40 },
    { text: "welcome", start: 2.50, end: 3.00 }
  ];
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "smart", width: 1080, height: 1920 })),
    ["Hello everybody", "welcome"]
  );
});

test("a word that will not fit is not dragged into the tail", () => {
  // 20 + 1 + 21 = 42 characters against this comp's 40. Moving the cut has
  // to obey the budget it is moving within, or the repair produces exactly
  // what the budget exists to prevent: a caption too wide for the frame.
  const w = [
    { text: "The", start: 0.00, end: 0.20 },
    { text: "long", start: 0.25, end: 0.50 },
    { text: "antidisestablishment", start: 0.55, end: 1.10 },
    { text: "counterrevolutionary.", start: 1.15, end: 1.80 }
  ];
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "smart", width: 1080, height: 1920 })),
    ["The long antidisestablishment", "counterrevolutionary."]
  );
});

test("moving a cut never strands the caption it borrowed from", () => {
  // Nine words at a four-word budget is 4+4+1; the repair must land on
  // 4+3+2 and not 4+4 followed by a pair of ones.
  const out = seg.segment(evenWords("one two three four five six seven eight nine.", 0.3),
    { mode: "smart", width: 1080, height: 1920 });
  out.captions.forEach((c) => assert.ok(c.words.length >= 2,
    "stranded: " + JSON.stringify(c.text) + " in " + texts(out).join(" | ")));
});

test("moving a cut never pushes a caption past its budgets", () => {
  // The whole point of the cut is that the caption was full. Moving it must
  // respect every bound that put it there.
  const bounds = seg.chooseLayout(1080, 1920).options;
  const out = seg.segment(
    evenWords("there is quite a lot of speech here to divide up between the " +
              "two shapes and it carries on for a while yet.", 0.3),
    { mode: "smart", width: 1080, height: 1920 });
  out.captions.forEach((c) => {
    assert.ok(c.words.length <= bounds.maxWords,
      c.words.length + " words: " + JSON.stringify(c.text));
    assert.ok(c.text.length <= bounds.maxCharsPerLine * bounds.maxLines,
      c.text.length + " chars: " + JSON.stringify(c.text));
    assert.ok(c.end - c.start <= bounds.maxDurationS,
      (c.end - c.start).toFixed(2) + "s: " + JSON.stringify(c.text));
  });
});

test("rebalancing leaves the fixed-count modes alone", () => {
  // Their whole point is a metronomic rhythm, so a one-word tail at the end
  // of "three words each" is correct and must survive.
  assert.deepStrictEqual(
    texts(seg.segment(evenWords("one two three four five six seven"), { mode: "three" })),
    ["one two three", "four five six", "seven"]
  );
});

// --- sentence mode in the panel ---------------------------------------------

test("sentence mode wraps to the comp, not to a broadcast measure", () => {
  // It is offered in the panel now, so it meets vertical comps. A 42-character
  // line on a 1080-wide frame runs off both edges — that shipped once already.
  const long = "this is a deliberately long sentence that runs well past " +
               "forty two characters and keeps going for a while yet.";
  const tall = seg.segment(evenWords(long, 0.12),
    { mode: "sentence", width: 1080, height: 1920 });
  const wide = seg.segment(evenWords(long, 0.12),
    { mode: "sentence", width: 1920, height: 1080 });

  const widest = (out) => Math.max(...out.captions.map(
    (c) => Math.max(...c.lines.map((l) => l.length))));

  assert.ok(widest(tall) <= seg.VERTICAL_DEFAULTS.maxCharsPerLine,
    "vertical lines run to " + widest(tall) + " characters");
  assert.ok(widest(wide) <= seg.PHRASE_DEFAULTS.maxCharsPerLine,
    "horizontal lines run to " + widest(wide) + " characters");
  assert.ok(widest(tall) < widest(wide), "the comp made no difference");
});

test("sentence mode still cuts only on punctuation, whatever the comp", () => {
  const w = evenWords("I went to the store. It was closed. So I left.");
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "sentence", width: 1080, height: 1920 })),
    ["I went to the store.", "It was closed.", "So I left."]
  );
});

test("sentence mode reports the layout it wrapped to", () => {
  // main.js logs this; a mode that silently reshapes captions is the thing
  // the rationale exists to prevent.
  const out = seg.segment(evenWords("one two three."),
    { mode: "sentence", width: 1080, height: 1920 });
  assert.strictEqual(out.layout.orientation, "vertical");
  assert.match(out.layout.rationale, /sentence/i);
});


// --- when a caption is on screen --------------------------------------------

test("every caption starts exactly on its first word, in every mode", () => {
  // The one invariant hold() may never trade away. Type that leads or lags
  // the voice is wrong against the only reference the viewer has.
  const w = words("here is a line of speech with a pause in it".split(" "));
  w[6].start += 1.4;                       // shove a real pause into the middle
  w[6].end += 1.4;
  for (let i = 7; i < w.length; i++) { w[i].start += 1.4; w[i].end += 1.4; }

  for (const mode of ["smart", "sentence", "one", "two", "three", "phrase", "parts"]) {
    seg.segment(w, { mode, width: 1080, height: 1920 }).captions.forEach((c) => {
      assert.strictEqual(c.start, c.words[0].start,
        mode + ' caption "' + c.text + '" does not start on its word');
    });
  }
});

test("a caption the budget cut runs on to the next one", () => {
  // Two captions from one breath: the screen must not blink between them.
  const out = seg.segment(evenWords("I really enjoyed making this.", 0.35),
    { mode: "smart", width: 1080, height: 1920 });
  assert.strictEqual(out.captions.length, 2);
  assert.strictEqual(out.captions[0].end, out.captions[1].start,
    "a hole opened up where the budget cut");
});

test("a real silence still clears the screen", () => {
  // Holding type through a silence is the bug the v0.4.0 notes call "a word
  // held for six seconds", not a feature. The caption runs on past its last
  // word, then stops; it does not reach for the next one.
  const w = [
    { text: "Done.", start: 0.00, end: 0.60 },
    { text: "Then", start: 3.40, end: 3.70 },   // 2.8s of silence
    { text: "again", start: 3.75, end: 4.10 }
  ];
  const out = seg.segment(w, { mode: "smart", width: 1080, height: 1920 });
  assert.strictEqual(out.captions[0].end, 0.60 + seg.MAX_HOLD_S);
  assert.ok(out.captions[0].end < out.captions[1].start,
    "held all the way across a silence the speaker actually took");
});

test("a caption too brief to read is held, not started early", () => {
  // "Wait." is spoken in 0.18s -- four frames. Nothing may move its start to
  // buy reading time, so the time comes off the end.
  const w = [
    { text: "Wait.", start: 0.00, end: 0.18 },
    { text: "I", start: 2.50, end: 2.60 },
    { text: "know", start: 2.65, end: 2.90 },
    { text: "this.", start: 2.95, end: 3.30 }
  ];
  const out = seg.segment(w, { mode: "smart", width: 1080, height: 1920 });
  assert.strictEqual(out.captions[0].start, 0.00, "the start moved");
  assert.strictEqual(out.captions[0].end, 0.18 + seg.MAX_HOLD_S);
  assert.ok(out.captions[0].end - out.captions[0].start > 1.0,
    "still on screen for " + (out.captions[0].end).toFixed(2) + "s");
});

test("the blank after a caption grows with the silence, in step", () => {
  // This was two rules once -- bridge a hole under the ceiling, otherwise
  // hold to a minimum -- and it jumped at the boundary: a 1.20s pause played
  // continuous and a 1.21s pause blanked for nearly a second. One rule makes
  // the blank grow from nothing as the silence does.
  const blankAfter = (silence) => {
    const out = seg.segment([
      { text: "one", start: 0.0, end: 0.4 },
      { text: "two", start: 0.4 + silence, end: 0.8 + silence }
    ], { mode: "one" });
    return out.captions[1].start - out.captions[0].end;
  };
  assert.strictEqual(blankAfter(seg.MAX_HOLD_S - 0.2), 0, "blanked early");
  assert.strictEqual(blankAfter(seg.MAX_HOLD_S), 0, "blanked at the ceiling");
  assert.ok(Math.abs(blankAfter(seg.MAX_HOLD_S + 0.01) - 0.01) < 1e-6,
    "a hair over the ceiling blanks for " +
    blankAfter(seg.MAX_HOLD_S + 0.01).toFixed(3) + "s, not 0.01s");
});

test("a caption is never held into the one after it", () => {
  // The recogniser hands back overlapping words at chunk boundaries. Two
  // caption layers lit at once is worse than one a few frames short, so the
  // cap pulls the end back rather than letting them collide.
  const w = [
    { text: "one", start: 0.0, end: 0.5 },
    { text: "two", start: 0.4, end: 0.9 },
    { text: "three", start: 0.8, end: 1.3 },
    { text: "four", start: 1.2, end: 1.7 },
    { text: "five", start: 1.6, end: 2.1 },
    { text: "six", start: 2.0, end: 2.5 }
  ];
  const out = seg.segment(w, { mode: "smart", width: 1080, height: 1920 });
  for (let i = 1; i < out.captions.length; i++) {
    assert.ok(out.captions[i].start >= out.captions[i - 1].end,
      "captions " + (i - 1) + " and " + i + " are on screen together");
  }
  out.captions.forEach((c) => assert.ok(c.end >= c.start, "inverted caption"));
});

test("sentence captions are held together too", () => {
  const w = [
    { text: "No.", start: 0.00, end: 0.20 },
    { text: "Stop.", start: 0.25, end: 0.60 }
  ];
  const out = seg.segment(w, { mode: "sentence", width: 1080, height: 1920 });
  assert.strictEqual(out.captions.length, 2);
  assert.strictEqual(out.captions[0].end, out.captions[1].start,
    "the screen blinks between two sentences spoken back to back");
});

test("sentence mode does not hold type through a silence", () => {
  // The trap in reusing maxGapS as the hold threshold: sentence mode sets it
  // to 99 to mean "never CUT on a pause", which as a hold would leave a
  // caption on screen for the whole silence after it.
  const w = [
    { text: "Done.", start: 0.00, end: 0.60 },
    { text: "Later.", start: 6.00, end: 6.40 }
  ];
  const out = seg.segment(w, { mode: "sentence", width: 1080, height: 1920 });
  assert.strictEqual(out.captions[0].end, 0.60 + seg.MAX_HOLD_S,
    "held for " + (out.captions[0].end - 0.60).toFixed(2) + "s of silence");
  assert.ok(out.captions[0].end < out.captions[1].start);
});


// --- cutting on the speech, not on the word count ---------------------------

/**
 * Words from [text, spokenSeconds] pairs, where a null text is a silence.
 * Ordinary articulation leaves 0.06s between words unless said otherwise.
 */
function spoken(spec, spacing = 0.06) {
  let t = 0;
  const out = [];
  for (const [text, dur] of spec) {
    if (text === null) { t += dur; continue; }
    out.push({ text, start: +t.toFixed(3), end: +(t + dur).toFixed(3) });
    t += dur + spacing;
  }
  return out;
}

/**
 * The reported clip, exactly as the recogniser timed it: 55 words, and the
 * end of every one is the start of the next, so there is not one measurable
 * gap in the whole transcript. Voice over a music bed, which is what these
 * captions are for -- there is no silence in it to find.
 */
const REPORTED_FULL = backToBack([
  ["Going",0.334],["into",0.125],["my",0.084],["career,",0.417],["I",0.167],
  ["think",0.166],["it's",0.209],["more",0.250],["important",0.334],
  ["for",0.250],["me",0.209],["to",0.250],["find",0.417],["the",0.125],
  ["place",0.334],["that",0.167],["really",0.333],["finds",0.376],
  ["me",0.166],["and",0.167],["chooses",0.459],["me",0.250],["as",0.167],
  ["a",0.084],["person,",0.458],["holds",0.417],["me",0.167],["with",0.167],
  ["value",0.292],["and",0.167],["supports",0.417],["me.",0.250],
  ["And",0.209],["that's",0.333],["more",0.251],["important",0.292],
  ["to",0.167],["me",0.333],["than",0.250],["trying",0.376],["to",0.167],
  ["find,",0.333],["you",0.167],["know,",0.125],["the",0.251],
  ["best",0.333],["position",0.459],["or",0.250],["the",0.084],
  ["best",0.333],["job",0.292],["or",0.167],["the",0.167],["best",0.250],
  ["place.",0.250]
]);

test("a caption the budget closes is cut where the speaker held a word", () => {
  // The reported line, with the timings the recogniser actually produced:
  // every word ends where the next begins, so there is not one measurable
  // gap in it. The cut has to come from somewhere else.
  //
  // This speaker says "to" three times. Twice it takes 0.167s; here it takes
  // 0.250s, because they hang on it while deciding what comes next. That is
  // 1.50x their own normal, and it is the whole signal.
  const out = seg.segment(REPORTED_FULL, { mode: "smart", width: 1920, height: 1080 });
  assert.strictEqual(texts(out)[0],
    "Going into my career, I think it's more important for me to");
  assert.strictEqual(texts(out)[1],
    "find the place that really finds me and chooses me as a person,");
});

test("a word said once is not evidence of anything", () => {
  // It scores nothing rather than being estimated. An earlier version guessed
  // a baseline from syllables and word class for these, and the guess was in
  // different units from the measurement: "for", said once, scored 2.94x
  // against an invented 0.085s and beat the 1.50x that "to" really measured.
  const out = seg.segment(REPORTED_FULL, { mode: "smart", width: 1920, height: 1080 });
  assert.ok(!/ for$/.test(texts(out)[0]),
    "cut on a word with no baseline: " + texts(out)[0]);
});

test("a gap that does not stand out from the speaker does not move the cut", () => {
  // Someone slow and deliberate leaves air between every word. A gap a little
  // wider than their normal one is not a breath, it is them talking, and
  // cutting on it would chop the line for no reason.
  const w = spoken([
    ["one",.2],["two",.2],["three",.2],["four",.2],["five",.2],["six",.2],
    ["seven",.2],["eight",.2],["nine",.2],["ten",.2],["eleven",.2],
    [null,.15],                                  // 0.45s against a 0.30s norm
    ["twelve",.2],["thirteen",.2],["fourteen",.2],["fifteen",.2],["sixteen",.2]
  ], 0.30);
  // This window is closed by the duration cap rather than the word count --
  // slow speech runs out of seconds first -- which is budget either way. The
  // claim is only that the cut did not move back onto the 0.45s gap, so it
  // is the word after that gap that has to still be there.
  const out = seg.segment(w, { mode: "smart", width: 1920, height: 1080 });
  assert.ok(/ twelve$/.test(texts(out)[0]),
    "cut moved for a gap only 1.5x the median: " + texts(out)[0]);
});

test("a breath early in the window does not leave a half-empty caption", () => {
  // The budget is what put us here, so the caption is entitled to its line.
  // A break three words in is a real breath and still the wrong place.
  const w = spoken([
    ["one",.2],["two",.2],["three",.2],
    [null,.34],                                  // 0.40s, but far too early
    ["four",.2],["five",.2],["six",.2],["seven",.2],["eight",.2],["nine",.2],
    ["ten",.2],["eleven",.2],["twelve",.2],["thirteen",.2],["fourteen",.2],
    ["fifteen",.2],["sixteen",.2]
  ]);
  const out = seg.segment(w, { mode: "smart", width: 1920, height: 1080 });
  assert.ok(out.captions[0].words.length >= 7,
    "cut at word " + out.captions[0].words.length + " of a 14-word window");
});

test("the speaker's own pause still cuts exactly where it falls", () => {
  // Nothing above may weaken this: a gap over maxGapS ends the caption there
  // whatever the budget has left, and bestCut never sees it.
  const w = spoken([
    ["stop",.3],["right",.3],["there",.3],
    [null,.8],                                   // 0.86s — over maxGapS
    ["and",.2],["then",.2],["carry",.3],["on",.2]
  ]);
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0],
    "stop right there"
  );
});

test("sentence mode does not strand the last word of a long sentence", () => {
  // Reported alongside the above: one sentence running past the duration cap
  // put "me." on a layer of its own. A cut the cap made is a cut arithmetic
  // made, exactly like a phrase cut by the word budget, and gets the same
  // treatment.
  const w = spoken(
    ("Going into my career I think it is more important for me to find the " +
     "place that really finds me and chooses me as a person holds me with " +
     "value and supports me.").split(" ").map((t) => [t, 0.22]), 0.025);
  const out = seg.segment(w, { mode: "sentence", width: 1920, height: 1080 });
  assert.ok(out.captions.length > 1, "the duration cap did not fire");
  out.captions.forEach((c) => assert.ok(c.words.length >= 2,
    "stranded " + JSON.stringify(c.text)));
});

test("sentence mode still lets a short sentence be short", () => {
  // The floor must not glue two sentences together to make a word count.
  const w = spoken([["No.",.3],["Stop.",.35],["Listen",.3],["to",.12],["me.",.25]]);
  assert.deepStrictEqual(
    texts(seg.segment(w, { mode: "sentence", width: 1920, height: 1080 })),
    ["No.", "Stop.", "Listen to me."]
  );
});

test("two equally long holds cut at the later one", () => {
  // The caption should be as full as it can be, so a tie goes to the break
  // that uses more of the line. Durations are quarters of a second because
  // those are exact in binary: at 0.2 and 0.3 the two holds differ in the
  // sixteenth decimal and the "tie" is decided by rounding rather than by
  // the rule under test.
  const w = backToBack([
    ["one",.25],["two",.25],["three",.25],["four",.25],["five",.25],
    ["six",.25],["seven",.25],["hold",.5],["early",.25],["ten",.25],
    ["hold",.5],["late",.25],["thirteen",.25],["fourteen",.25],
    ["hold",.25],["done",.25]
  ]);
  const first = texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0];
  assert.ok(/ hold$/.test(first), "did not cut on a hold: " + first);
  assert.ok(/early/.test(first),
    "cut on the FIRST of two equal holds, wasting the line: " + first);
});

test("a word broken off mid-utterance is never the cut", () => {
  // A restart -- "I want- I want to" -- stretches the fragment, so it scores
  // like a hold and repeats often enough to earn a baseline. It is a speaker
  // losing the thread, which is the worst place to end a caption.
  const w = backToBack([
    ["one",.2],["two",.2],["three",.2],["four",.2],["five",.2],["six",.2],
    ["seven",.2],["with-",.3],["nine",.2],["ten",.2],["eleven",.2],
    ["with-",.2],["thirteen",.2],["fourteen",.2],["fifteen",.2],["sixteen",.2]
  ]);
  const first = texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0];
  assert.ok(!/with-$/.test(first), "broke on a cut-off word: " + first);
});


// --- cutting on punctuation -------------------------------------------------
//
// These fixtures give every word an end equal to the next word's start, which
// is what the speech model actually produces: it reports only token STARTS,
// so the gap between any two words is exactly zero. Checked against a real
// 55-word transcript -- all 54 gaps were 0.000. Any test here that invents a
// pause is testing a situation that does not arise.

/** Words with no measurable silence anywhere, as the recogniser reports them. */
function backToBack(spec) {
  let t = 0;
  const out = [];
  for (const [text, dur] of spec) {
    out.push({ text, start: +t.toFixed(3), end: +(t + dur).toFixed(3) });
    t += dur;
  }
  return out;
}

const REPORTED = backToBack([
  ["Going",.334],["into",.125],["my",.084],["career,",.417],["I",.167],
  ["think",.166],["it's",.209],["more",.250],["important",.334],["for",.250],
  ["me",.209],["to",.250],["find",.417],["the",.125],["place",.334],
  ["that",.167],["really",.333],["finds",.376],["me",.166],["and",.167],
  ["chooses",.459],["me",.250],["as",.167],["a",.084],["person,",.458],
  ["holds",.417],["me",.167],["with",.167],["value",.292],["and",.167],
  ["supports",.417],["me.",.250]
]);

test("a sentence too long for the cap breaks at its last comma", () => {
  // Reported: the cap fired wherever the seconds ran out and left "supports
  // me." on a layer of its own. There is a comma in reach, and a comma is
  // where the sentence already breaks.
  const out = seg.segment(REPORTED, { mode: "sentence", width: 1920, height: 1080 });
  assert.strictEqual(out.captions.length, 2);
  assert.ok(/as a person,$/.test(out.captions[0].text),
    "first caption ends: " + JSON.stringify(out.captions[0].text.slice(-30)));
  assert.strictEqual(out.captions[1].text, "holds me with value and supports me.");
});

test("smart breaks at the comma too, with no pause to go on", () => {
  const out = seg.segment(REPORTED, { mode: "smart", width: 1920, height: 1080 });
  const texts_ = texts(out);
  assert.ok(texts_.some((t) => /as a person,$/.test(t)),
    "no caption ended on the comma: " + texts_.join(" | "));
  assert.strictEqual(texts_[texts_.length - 1], "holds me with value and supports me.");
});

test("a comma outranks a pause when both are in reach", () => {
  // The speaker's own punctuation is a stronger boundary than anything we can
  // infer from the gaps around it.
  const w = backToBack([
    ["one",.2],["two",.2],["three",.2],["four",.2],["five",.2],["six",.2],
    ["seven",.2],["eight,",.2],["nine",.2],["ten",.2],["eleven",.2],
    ["twelve",.2],["thirteen",.2],["fourteen",.2],["fifteen",.2],["sixteen",.2]
  ]);
  // A wide pause after "eleven", later than the comma but weaker than it.
  w.slice(11).forEach((x) => { x.start += 0.5; x.end += 0.5; });
  assert.ok(/eight,$/.test(texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0]),
    "cut away from the comma: " +
    texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0]);
});

test("a word cut off mid-utterance is not a clause ending", () => {
  // "holds me with-" is a speaker being interrupted, which is the opposite of
  // a place to break.
  const w = backToBack([
    ["one",.2],["two",.2],["three",.2],["four",.2],["five",.2],["six",.2],
    ["seven",.2],["with-",.2],["nine",.2],["ten",.2],["eleven",.2],
    ["twelve",.2],["thirteen",.2],["fourteen",.2],["fifteen",.2],["sixteen",.2]
  ]);
  assert.ok(!/with-$/.test(texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0]),
    "broke on a trailing hyphen");
});

test("a comma too early in the window is not worth breaking on", () => {
  // Same rule as a pause: the budget put us here, so the caption is entitled
  // to its line. A comma three words in would waste it.
  const w = backToBack([
    ["one,",.2],["two",.2],["three",.2],["four",.2],["five",.2],["six",.2],
    ["seven",.2],["eight",.2],["nine",.2],["ten",.2],["eleven",.2],
    ["twelve",.2],["thirteen",.2],["fourteen",.2],["fifteen",.2],["sixteen",.2]
  ]);
  const first = seg.segment(w, { mode: "smart", width: 1920, height: 1080 }).captions[0];
  assert.ok(first.words.length >= 7, "cut at word " + first.words.length);
});

test("with two commas in reach, the later one is the cut", () => {
  // Both are real boundaries; the later one leaves a fuller caption. Reported
  // as "cutting after the second comma, and not leaving a few words stranded
  // near the end".
  const w = backToBack([
    ["one",.25],["two",.25],["three",.25],["four",.25],["five",.25],
    ["six",.25],["seven",.25],["first,",.25],["nine",.25],["ten",.25],
    ["eleven",.25],["second,",.25],["thirteen",.25],["fourteen",.25],
    ["fifteen",.25],["sixteen",.25]
  ]);
  const first = texts(seg.segment(w, { mode: "smart", width: 1920, height: 1080 }))[0];
  assert.ok(/ second,$/.test(first),
    "cut at the earlier comma, stranding the rest: " + first);
});


// --- the under-measured pause (align.py's reported case, from the panel side)
//
// The waveform is flat from ~12.45s to ~13.05s -- a genuine ~0.6s silence --
// but Parakeet stamps the first word after it early (see
// backend/app/align.py), so the gap the panel actually receives measures
// only ~0.28s: comfortably under maxGapS in every mode (0.5 horizontal, 0.45
// vertical), so reach() reads it as a within-phrase breath. Before this fix,
// bestCut had no way to prefer that 0.28s outlier over the budget's default
// position, because every word here is said once (no heldFor baseline) and
// there is no comma in reach -- so the caption ran on into the next thought,
// exactly as reported. align.py should widen a gap like this back toward its
// true ~0.6s at the source; these tests cover the panel's own defence, for
// whatever gap actually arrives -- a chunk boundary, align.py disabled, or
// simply a pause align.py's own silence-run threshold does not clear.

test("smart 16:9 cuts on an under-measured pause instead of gluing the next thought on", () => {
  // 13 fluent words (~0.05s gaps) exactly fill this mode's 14-word budget
  // once the pause word is added, so the run closes AT that word -- the
  // shape the reported bug needed: nothing left over to reach() with.
  const pre = words(
    "Going into my career I think it's more important for me to find".split(" ")
  );
  const last = pre[pre.length - 1];
  // 0.28s: the early-stamped measurement of a pause that was really ~0.6s.
  const pause = { text: "the", start: +(last.end + 0.28).toFixed(3), end: +(last.end + 0.58).toFixed(3) };
  const after = words(["place", "that", "really"], { start: +(pause.end + 0.05).toFixed(3) });
  const w = pre.concat([pause], after);

  const out = seg.segment(w, { mode: "smart", width: 1920, height: 1080 });

  assert.ok(!/ the$/.test(texts(out)[0]),
    "glued the post-pause word onto the caption before it: " + JSON.stringify(texts(out)[0]));
  assert.ok(/^the /.test(texts(out)[1] || ""),
    "the post-pause word did not start its own caption: " + texts(out).join(" | "));
});

test("smart 9:16 cuts on an under-measured pause instead of gluing the next thought on", () => {
  // 3 fluent words exactly fill this mode's 4-word budget once the pause
  // word is added. No comma anywhere in reach, on purpose -- this isolates
  // the gap mechanism from the punctuation check, which is covered on its
  // own terms elsewhere ("a comma outranks a pause when both are in reach").
  const pre = words(["Going", "into", "my"]);
  const last = pre[pre.length - 1];
  const pause = { text: "career", start: +(last.end + 0.28).toFixed(3), end: +(last.end + 0.70).toFixed(3) };
  const after = words(["I", "think", "it's"], { start: +(pause.end + 0.05).toFixed(3) });
  const w = pre.concat([pause], after);

  const out = seg.segment(w, { mode: "smart", width: 1080, height: 1920 });

  assert.ok(!/ career$/.test(texts(out)[0]),
    "glued the post-pause word onto the caption before it: " + JSON.stringify(texts(out)[0]));
  assert.ok(/^career /.test(texts(out)[1] || ""),
    "the post-pause word did not start its own caption: " + texts(out).join(" | "));
});

test("an evenly slow speaker's normal-sized gaps never qualify as a pause", () => {
  // Guards the failure mode GAP_ABS_FLOOR alone would introduce: a speaker
  // whose every gap is a little wide (0.30s, well past the 0.25s floor)
  // still must not be cut early just because each of their ordinary gaps
  // clears that floor -- only an OUTLIER against their own rhythm may. This
  // is the same claim as "a gap that does not stand out" above, checked
  // directly against gapAt/medianGap rather than through a duration-capped
  // fixture.
  const w = words(
    "one two three four five six seven eight nine ten eleven twelve thirteen".split(" "),
    { gap: 0.30 }
  );
  const out = seg.segment(w, { mode: "smart", width: 1920, height: 1080 });
  // Every gap is 0.3s -- past GAP_ABS_FLOOR on its own, but never 2.5x a
  // median that is itself 0.3s. The run's own maxDurationS (6.0s) closes it
  // at "ten" (0.6s per word x 10 = 6.0s to the 11th word's start); if a
  // uniform gap wrongly qualified, this would come out as nine words instead.
  assert.strictEqual(texts(out)[0], "one two three four five six seven eight nine ten",
    "a uniform gap moved the cut off the budget's own position: " +
    texts(out).join(" | "));
});

test("rebalance still rescues a stranded word for a slow, even speaker", () => {
  // Every gap is 0.30s: past the pause floor, but none stands out, so none is
  // a break the speaker made. Five words against a four-word budget must
  // still come out 3 + 2, not 4 + 1.
  const texts = ["I", "really", "enjoyed", "making", "this."];
  const words = texts.map((text, i) => ({
    text, start: i * 0.6, end: i * 0.6 + 0.3, confidence: 1
  }));
  const out = seg.segment(words, {
    mode: "phrase", options: { maxWords: 4, minWords: 2, maxGapS: 0.6 }
  });
  const shape = out.captions.map((c) => c.text);
  assert.deepEqual(shape, ["I really enjoyed", "making this."]);
});
