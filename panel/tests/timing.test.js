const test = require("node:test");
const assert = require("node:assert");
const timing = require("../dormant/animation/timing.js");

test("zero-duration layer produces no animation", () => {
  const r = timing.computeTimings(0);
  assert.strictEqual(r.inDuration, 0);
  assert.strictEqual(r.outDuration, 0);
});

test("invalid durations are treated as zero, not NaN", () => {
  for (const bad of [undefined, null, NaN, -5, "abc"]) {
    const r = timing.computeTimings(bad);
    assert.ok(Number.isFinite(r.inDuration), `not finite for ${bad}`);
    assert.strictEqual(r.inDuration, 0);
  }
});

test("in-animation always resolves within the first half", () => {
  // The whole point of the module: preset systems fail exactly here, on
  // short words. Swept rather than spot-checked.
  for (let d = 0.05; d <= 10; d += 0.05) {
    const r = timing.computeTimings(d);
    assert.ok(
      r.inEnd <= d * 0.5 + 1e-9,
      `${d.toFixed(2)}s resolved at ${(100 * r.inEnd / d).toFixed(1)}%`
    );
  }
});

test("maxInFraction is honoured when tightened", () => {
  for (const cap of [0.2, 0.3, 0.4, 0.5]) {
    for (let d = 0.1; d <= 5; d += 0.1) {
      const r = timing.computeTimings(d, { maxInFraction: cap });
      assert.ok(
        r.inEnd <= d * cap + 1e-9,
        `cap ${cap} violated at ${d.toFixed(2)}s`
      );
    }
  }
});

test("the resolve cap overrides the minimum on very short layers", () => {
  // A 0.1s word cannot afford the 0.10s minimum: finishing on time beats
  // honouring a floor.
  const r = timing.computeTimings(0.1, { inMin: 0.1, maxInFraction: 0.5 });
  assert.ok(r.inDuration <= 0.05 + 1e-9);
});

test("long layers are capped by inMax, not left proportional", () => {
  const r = timing.computeTimings(30);
  assert.ok(r.inDuration <= timing.DEFAULTS.inMax + 1e-9);
});

test("short layers are not left imperceptibly fast", () => {
  const r = timing.computeTimings(2.0);
  assert.ok(r.inDuration >= timing.DEFAULTS.inMin - 1e-9);
});

test("in and out never overrun the layer", () => {
  for (let d = 0.05; d <= 10; d += 0.05) {
    const r = timing.computeTimings(d);
    assert.ok(
      r.inDuration + r.outDuration <= d * 0.9 + 1e-9,
      `phases overran at ${d.toFixed(2)}s`
    );
    assert.ok(r.holdDuration >= -1e-9, `negative hold at ${d.toFixed(2)}s`);
  }
});

test("out phase is anchored to the end of the layer", () => {
  const r = timing.computeTimings(3.0);
  assert.ok(Math.abs(r.outEnd - 3.0) < 1e-9);
  assert.ok(Math.abs(r.outStart - (3.0 - r.outDuration)) < 1e-9);
});

test("hasOut:false removes the out phase and returns the time to hold", () => {
  const withOut = timing.computeTimings(2.0);
  const without = timing.computeTimings(2.0, { hasOut: false });
  assert.strictEqual(without.outDuration, 0);
  assert.ok(without.holdDuration > withOut.holdDuration);
});

test("phases scale proportionally rather than one being truncated", () => {
  // Both requested minimums cannot fit; the ratio between them should hold.
  const r = timing.computeTimings(0.2, { inMin: 0.5, outMin: 0.25, inMax: 1, outMax: 1 });
  assert.ok(r.inDuration + r.outDuration <= 0.2 * 0.9 + 1e-9);
  assert.ok(r.inDuration > r.outDuration, "the larger phase should stay larger");
});

test("longer captions resolve proportionally earlier", () => {
  const short = timing.resolveFraction(0.4);
  const long = timing.resolveFraction(4.0);
  assert.ok(long < short, "a long phrase should resolve earlier in relative terms");
});

test("documented examples hold", () => {
  const cases = [[0.3, 0.33], [0.6, 0.25], [2.5, 0.18]];
  for (const [duration, expected] of cases) {
    const actual = timing.resolveFraction(duration);
    assert.ok(
      Math.abs(actual - expected) < 0.02,
      `${duration}s resolved at ${actual.toFixed(3)}, expected ~${expected}`
    );
  }
});

// --- explicit length --------------------------------------------------------
//
// The fraction model scales every animation to its caption, which is why one
// preset ran for 0.105s, 0.180s and 0.220s on captions of different lengths
// and never had a consistent feel. The "resolve within %" slider that was
// supposed to control this was a CAP, and inert in practice: on any caption of
// 1.2s or longer it produced exactly the same duration at every position,
// because inMax bound first.

test("the old percentage cap really was inert on ordinary captions", () => {
  // Pinning the reported behaviour so the replacement cannot regress to it.
  const wordPop = { inFraction: 0.30, inMin: 0.08, inMax: 0.22, hasOut: false };
  const at = (pct) =>
    timing.computeTimings(1.2, Object.assign({}, wordPop, { maxInFraction: pct / 100 }))
      .inDuration;

  assert.strictEqual(at(40), at(100), "the cap never bound, so it did nothing");
  assert.strictEqual(at(60), at(100));
});

test("an explicit length overrides the fraction rules", () => {
  const r = timing.computeTimings(2.0, { inSeconds: 0.35, hasOut: false });
  assert.ok(Math.abs(r.inDuration - 0.35) < 1e-9);
});

test("an explicit length is the same on every caption length", () => {
  // The whole point: a preset should feel identical everywhere it is applied.
  const lengths = [0.6, 1.2, 2.5, 6.0];
  const durations = lengths.map(
    (d) => timing.computeTimings(d, { inSeconds: 0.3, hasOut: false }).inDuration
  );
  assert.deepStrictEqual(
    durations.map((d) => +d.toFixed(6)),
    durations.map(() => 0.3)
  );
});

test("an explicit length still cannot overrun a short caption", () => {
  // The safety the fraction model existed to provide has to survive.
  const r = timing.computeTimings(0.3, { inSeconds: 5.0, hasOut: false });
  assert.ok(r.inDuration <= 0.3 * timing.DEFAULTS.maxInFraction + 1e-9,
            "a 5s entrance on a 0.3s word must be clamped, not left to overrun");
});

test("an explicit out length is honoured and clamped too", () => {
  const long = timing.computeTimings(4.0, { outSeconds: 0.5 });
  assert.ok(Math.abs(long.outDuration - 0.5) < 1e-9);

  const short = timing.computeTimings(0.3, { outSeconds: 5.0 });
  assert.ok(short.outDuration <= 0.3 * timing.DEFAULTS.maxOutFraction + 1e-9);
});

test("a zero or junk explicit length falls back to the fractions", () => {
  const fractions = timing.computeTimings(2.0, { hasOut: false });
  for (const bad of [0, -1, null, undefined, NaN, "abc"]) {
    const r = timing.computeTimings(2.0, { inSeconds: bad, hasOut: false });
    assert.strictEqual(r.inDuration, fractions.inDuration, "bad input: " + bad);
  }
});

// --- frames -----------------------------------------------------------------

test("frames convert against the comp's rate", () => {
  assert.ok(Math.abs(timing.toSeconds(12, "frames", 24) - 0.5) < 1e-9);
  assert.ok(Math.abs(timing.toSeconds(12, "frames", 30) - 0.4) < 1e-9);
});

test("seconds pass through untouched", () => {
  assert.ok(Math.abs(timing.toSeconds(0.35, "seconds", 24) - 0.35) < 1e-9);
});

test("a missing frame rate does not produce Infinity", () => {
  // A frame count divided by a missing rate would otherwise become Infinity
  // and clamp to the whole layer, which reads as "the animation never ends".
  for (const rate of [0, null, undefined, NaN]) {
    const seconds = timing.toSeconds(8, "frames", rate);
    assert.ok(isFinite(seconds) && seconds > 0, "rate " + rate);
  }
});

test("a junk length is zero, not NaN", () => {
  for (const bad of [0, -5, "abc", null, undefined]) {
    assert.strictEqual(timing.toSeconds(bad, "frames", 24), 0, "input: " + bad);
  }
});
