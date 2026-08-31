const test = require("node:test");
const assert = require("node:assert");
const timing = require("../js/lib/timing.js");

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
