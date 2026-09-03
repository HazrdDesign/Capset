const test = require("node:test");
const assert = require("node:assert");
const presets = require("../js/lib/presets.js");

const ANIMATION = {
  id: "word-pop",
  name: "Word Pop",
  description: "Hard scale punch.",
  basedOn: "characters",
  in: { fraction: 0.3, min: 0.08, max: 0.22,
        properties: [{ type: "scale", from: [58, 58], to: [100, 100], overshoot: 1.14 }],
        ease: { in: 72, out: 8 } }
};

// --- saving -----------------------------------------------------------------

test("a saved preset keeps the animation's motion", () => {
  const saved = presets.fromAnimation(ANIMATION, { name: "My Punch" });
  assert.deepStrictEqual(saved["in"], ANIMATION["in"]);
  assert.strictEqual(saved.name, "My Punch");
  assert.strictEqual(saved.custom, true);
});

test("a saved preset is a copy, not a reference", () => {
  // Otherwise editing a built-in — or shipping a new version of one — would
  // silently change what the user saved.
  const saved = presets.fromAnimation(ANIMATION, { name: "Mine" });
  saved["in"].properties[0].overshoot = 99;
  assert.strictEqual(ANIMATION["in"].properties[0].overshoot, 1.14);
});

test("a preset records what it was saved from", () => {
  const saved = presets.fromAnimation(ANIMATION, { name: "Mine" });
  assert.strictEqual(saved.savedFrom, "word-pop");
});

test("a nameless preset is refused", () => {
  assert.throws(() => presets.fromAnimation(ANIMATION, { name: "   " }), /name/i);
  assert.throws(() => presets.fromAnimation(ANIMATION, {}), /name/i);
});

test("saving without an animation is refused", () => {
  assert.throws(() => presets.fromAnimation(null, { name: "Mine" }), /Pick an animation/);
});

test("an overlong name is truncated rather than rejected", () => {
  const saved = presets.fromAnimation(ANIMATION, { name: "x".repeat(200) });
  assert.strictEqual(saved.name.length, presets.MAX_NAME);
});

test("ids are unique across presets saved from the same animation", () => {
  const a = presets.fromAnimation(ANIMATION, { name: "One", now: 1 });
  const b = presets.fromAnimation(ANIMATION, { name: "Two", now: 2 });
  assert.notStrictEqual(a.id, b.id);
});

test("an id survives a name made entirely of punctuation", () => {
  const saved = presets.fromAnimation(ANIMATION, { name: "!!!", now: 7 });
  assert.match(saved.id, /^user-preset-/);
});

test("a captured style rides along when given", () => {
  const saved = presets.fromAnimation(ANIMATION, {
    name: "Yellow Punch", style: { fontSize: 120, fillColor: [1, 1, 0] }
  });
  assert.strictEqual(saved.style.fontSize, 120);
});

// --- the file ---------------------------------------------------------------

test("a saved preset survives a round trip", () => {
  const saved = presets.fromAnimation(ANIMATION, { name: "Mine" });
  const back = presets.parse(presets.serialize([saved]));
  assert.deepStrictEqual(back, [saved]);
});

test("a corrupt presets file loses the presets, not the panel", () => {
  // Hand-edited or half-written files are not hypothetical, and losing the
  // animation library because of one is out of proportion.
  assert.deepStrictEqual(presets.parse("{ this is not json"), []);
  assert.deepStrictEqual(presets.parse(""), []);
  assert.deepStrictEqual(presets.parse("null"), []);
  assert.deepStrictEqual(presets.parse("[]"), []);
});

test("malformed entries are dropped and the rest kept", () => {
  const good = presets.fromAnimation(ANIMATION, { name: "Good" });
  const text = JSON.stringify({
    version: 1,
    presets: [
      good,
      { name: "no id" },
      { id: "no-name" },
      { id: "bad-phase", name: "Bad", in: "not an object" },
      { id: "bad-props", name: "Bad Props", in: { properties: "nope" } }
    ]
  });
  const parsed = presets.parse(text);
  assert.deepStrictEqual(parsed.map((p) => p.id), [good.id]);
});

test("duplicate ids in a file collapse to one", () => {
  const a = presets.fromAnimation(ANIMATION, { name: "Dup", now: 1 });
  const text = JSON.stringify({ version: 1, presets: [a, a] });
  assert.strictEqual(presets.parse(text).length, 1);
});

test("a preset read from a file is always marked custom", () => {
  // Otherwise the panel would offer no way to delete it.
  const text = JSON.stringify({
    version: 1, presets: [{ id: "x", name: "X", in: { properties: [] } }]
  });
  assert.strictEqual(presets.parse(text)[0].custom, true);
});

// --- managing ---------------------------------------------------------------

test("saving the same name twice replaces rather than duplicates", () => {
  const first = presets.fromAnimation(ANIMATION, { name: "Punch", now: 1 });
  const second = presets.fromAnimation(ANIMATION, { name: "Punch", now: 2 });
  const list = presets.upsert(presets.upsert([], first), second);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, second.id);
});

test("replacing a preset keeps its position in the list", () => {
  const a = presets.fromAnimation(ANIMATION, { name: "A", now: 1 });
  const b = presets.fromAnimation(ANIMATION, { name: "B", now: 2 });
  const c = presets.fromAnimation(ANIMATION, { name: "C", now: 3 });
  const updated = presets.fromAnimation(ANIMATION, { name: "B", now: 4 });
  const list = presets.upsert([a, b, c], updated);
  assert.deepStrictEqual(list.map((p) => p.name), ["A", "B", "C"]);
});

test("names match case-insensitively when replacing", () => {
  const a = presets.fromAnimation(ANIMATION, { name: "Punch", now: 1 });
  const b = presets.fromAnimation(ANIMATION, { name: "PUNCH", now: 2 });
  assert.strictEqual(presets.upsert([a], b).length, 1);
});

test("removing a preset leaves the others", () => {
  const a = presets.fromAnimation(ANIMATION, { name: "A", now: 1 });
  const b = presets.fromAnimation(ANIMATION, { name: "B", now: 2 });
  assert.deepStrictEqual(presets.remove([a, b], a.id).map((p) => p.name), ["B"]);
});

test("removing an unknown id changes nothing", () => {
  const a = presets.fromAnimation(ANIMATION, { name: "A", now: 1 });
  assert.strictEqual(presets.remove([a], "nope").length, 1);
});

// --- the library the panel shows -------------------------------------------

test("built-ins come first, then the user's own", () => {
  const mine = presets.fromAnimation(ANIMATION, { name: "Mine", now: 1 });
  const merged = presets.merge([{ id: "word-pop" }, { id: "hormozi" }], [mine]);
  assert.deepStrictEqual(merged.map((a) => a.id), ["word-pop", "hormozi", mine.id]);
});

test("a user preset can override a built-in of the same id", () => {
  // Losing silently to the built-in would look like saving had failed.
  const override = { id: "word-pop", name: "My Word Pop", custom: true };
  const merged = presets.merge([{ id: "word-pop", name: "Word Pop" }], [override]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].name, "My Word Pop");
});

test("no saved presets leaves the built-in library untouched", () => {
  const builtIns = [{ id: "a" }, { id: "b" }];
  assert.deepStrictEqual(presets.merge(builtIns, []), builtIns);
});

test("saving over one of two same-named presets keeps the other", () => {
  // upsert replaced the first match and then SKIPPED every later one, so a
  // list already holding two presets called "Punch" came back holding one.
  // A saved preset the user cannot see is gone as soon as the file is
  // written back.
  const existing = [
    { id: "a", name: "Punch", animation: {} },
    { id: "b", name: "Punch", animation: {} },
    { id: "c", name: "Slide", animation: {} }
  ];

  const after = presets.upsert(existing, { id: "new", name: "Punch", animation: {} });

  assert.strictEqual(after.length, 3, "a preset was dropped: " +
    after.map((p) => p.id).join(", "));
  assert.ok(after.some((p) => p.id === "new"), "the new preset was not saved");
  assert.ok(after.some((p) => p.id === "b"), "the second Punch was discarded");
  assert.ok(after.some((p) => p.id === "c"), "an unrelated preset was lost");
});
