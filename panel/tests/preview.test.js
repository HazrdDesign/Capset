/**
 * The preview engine samples the same animation definitions the host script
 * applies, so these tests are as much about the two staying in step as about
 * the maths.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const preview = require("../js/lib/preview.js");
const timing = require("../js/lib/timing.js");

const LIBRARY = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "animations", "animations.json"), "utf8")
);

function timingsFor(animation, duration = 1.2) {
  const spec = { hasOut: !!animation.out };
  if (animation.spansLayer) { spec.maxInFraction = 1; spec.maxTotalFraction = 1; }
  if (animation["in"]) {
    spec.inFraction = animation["in"].fraction;
    spec.inMin = animation["in"].min;
    spec.inMax = animation["in"].max;
  }
  if (animation.out) {
    spec.outFraction = animation.out.fraction;
    spec.outMin = animation.out.min;
    spec.outMax = animation.out.max;
  }
  return timing.computeTimings(duration, spec);
}

// --- easing -----------------------------------------------------------------

test("easing starts at 0 and ends at 1", () => {
  const ease = preview.easing(72, 8);
  assert.ok(Math.abs(ease(0)) < 1e-6);
  assert.ok(Math.abs(ease(1) - 1) < 1e-6);
});

test("easing is monotonic", () => {
  const ease = preview.easing(72, 8);
  let last = -1;
  for (let i = 0; i <= 100; i++) {
    const v = ease(i / 100);
    assert.ok(v >= last - 1e-9, `not monotonic at ${i / 100}`);
    last = v;
  }
});

test("a high incoming influence decelerates into the end", () => {
  // Influence is how far the handle reaches into the segment, so more of it
  // means a more gradual arrival — which is what makes a punch settle.
  const gentle = preview.easing(20, 8);
  const firm = preview.easing(85, 8);
  assert.ok(firm(0.5) > gentle(0.5),
            "the firmer ease should be further along at the midpoint");
});

test("After Effects' own Easy Ease is symmetric", () => {
  // 33.33% both sides is AE's default; anything else means the influence
  // mapping is wrong.
  const ease = preview.easing(33.33, 33.33);
  assert.ok(Math.abs(ease(0.5) - 0.5) < 0.01, "Easy Ease is not symmetric: " + ease(0.5));
});

// --- overshoot --------------------------------------------------------------

test("overshoot matches the host script's travel-based formula", () => {
  assert.strictEqual(preview.overshootValue(40, 100, 1.2), 112);
  assert.deepStrictEqual(preview.overshootValue([0, -80], [0, 0], 1.25), [0, 20]);
});

test("an overshooting property passes its target in the preview too", () => {
  const animation = {
    id: "pop",
    in: { fraction: 0.3, min: 0.1, max: 0.3,
          properties: [{ type: "scale", from: [50, 50], to: [100, 100], overshoot: 1.2 }],
          ease: { in: 72, out: 8 } }
  };
  const t = timingsFor(animation);
  let peak = 0;
  for (let i = 0; i <= 60; i++) {
    const s = preview.sampleUnit(animation, t, 0, 1, t.inStart + t.inDuration * (i / 60));
    peak = Math.max(peak, s.scale[0]);
  }
  assert.ok(peak > 100, "the preview never exceeded the target: " + peak);
  assert.ok(peak <= 110.01, "overshot further than the definition asks: " + peak);
});

// --- stagger ----------------------------------------------------------------

test("units animate in order", () => {
  const first = preview.staggered(0.3, 0, 5, 0.7);
  const last = preview.staggered(0.3, 4, 5, 0.7);
  assert.ok(first > last, "the last unit should lag the first");
});

test("the first unit starts immediately and the last finishes at the end", () => {
  assert.strictEqual(preview.staggered(0, 0, 5, 0.7), 0);
  assert.strictEqual(preview.staggered(1, 4, 5, 0.7), 1);
});

test("a single unit is not staggered", () => {
  assert.strictEqual(preview.staggered(0.5, 0, 1, 0.7), 0.5);
});

// --- sampling ---------------------------------------------------------------

test("before the animation starts, the from values hold", () => {
  const animation = {
    in: { fraction: 0.3, min: 0.1, max: 0.3,
          properties: [{ type: "opacity", from: 0, to: 100 }] }
  };
  const t = timingsFor(animation);
  assert.strictEqual(preview.sampleUnit(animation, t, 0, 1, 0).opacity, 0);
});

test("after the animation, properties are at rest", () => {
  const animation = {
    in: { fraction: 0.3, min: 0.1, max: 0.3,
          properties: [{ type: "scale", from: [50, 50], to: [100, 100] }] }
  };
  const t = timingsFor(animation);
  const s = preview.sampleUnit(animation, t, 0, 1, t.inEnd + 0.2);
  assert.deepStrictEqual(s.scale, [100, 100]);
  assert.strictEqual(s.opacity, 100);
});

test("$textColor resolves to the layer's own colour, not white", () => {
  // Hardcoding white here would misrepresent what the animation does to
  // someone whose captions are yellow.
  const animation = {
    in: { fraction: 0.5, min: 0.1, max: 1,
          properties: [{ type: "fillColor", from: [1, 0, 0], to: "$textColor" }],
          ease: { in: 0, out: 0 } }
  };
  const t = timingsFor(animation);
  // Just inside the phase: once it ends the property returns to rest, which
  // for colour means the layer's own colour takes over anyway.
  const s = preview.sampleUnit(animation, t, 0, 1, t.inStart + t.inDuration * 0.99,
                               { textColor: [0, 0.5, 1] });
  // Sampled just short of the end, so a small residual is expected: once the
  // phase completes the property returns to rest, which for colour IS the
  // layer's own colour. The two agree by design — that is the point of the
  // token. What matters is that it converged there and not on white.
  s.fillColor.forEach((c, i) => {
    assert.ok(Math.abs(c - [0, 0.5, 1][i]) < 0.02,
              "settled on " + s.fillColor + " rather than the layer's colour");
  });
  assert.ok(s.fillColor[0] < 0.5, "still carrying the accent colour");
});

test("no animation leaves everything at rest", () => {
  const t = timingsFor({});
  const s = preview.sampleUnit(null, t, 0, 1, 0.5);
  assert.strictEqual(s.opacity, 100);
  assert.deepStrictEqual(s.scale, [100, 100]);
});

// --- unit splitting ---------------------------------------------------------

test("word-based animations split on words", () => {
  assert.deepStrictEqual(preview.splitUnits("hello there world", "words"),
                         ["hello", "there", "world"]);
});

test("character-based animations split on characters", () => {
  assert.strictEqual(preview.splitUnits("abc", "characters").length, 3);
});

test("splitting ignores repeated whitespace", () => {
  assert.deepStrictEqual(preview.splitUnits("  a   b  ", "words"), ["a", "b"]);
});

// --- styles -----------------------------------------------------------------

test("styles carry transform, opacity and colour", () => {
  const styles = preview.stylesFor({
    opacity: 50, scale: [120, 120], position: [10, -20], rotation: 5,
    blur: [0, 0], tracking: 0, fillColor: [1, 0, 0]
  });
  assert.match(styles.transform, /scale\(1\.2,1\.2\)/);
  assert.match(styles.transform, /rotate\(5deg\)/);
  assert.strictEqual(styles.opacity, "0.5");
  assert.strictEqual(styles.color, "rgb(255,0,0)");
});

test("no colour means no inline colour, so the card's own colour shows", () => {
  const styles = preview.stylesFor({ opacity: 100, fillColor: null });
  assert.strictEqual(styles.color, "");
});

// --- the shipped library ----------------------------------------------------

test("every shipped animation can be sampled end to end", () => {
  LIBRARY.animations.forEach((animation) => {
    const t = timingsFor(animation);
    const units = preview.splitUnits("the quick brown fox", animation.basedOn);
    for (let i = 0; i <= 20; i++) {
      const at = (i / 20) * 1.2;
      units.forEach((_, index) => {
        const s = preview.sampleUnit(animation, t, index, units.length, at,
                                     { textColor: [1, 1, 1] });
        Object.keys(s).forEach((key) => {
          const values = s[key] instanceof Array ? s[key] : [s[key]];
          values.forEach((v) => {
            if (v === null) return;
            assert.ok(Number.isFinite(v),
                      `${animation.id} produced ${v} for ${key} at ${at}s`);
          });
        });
      });
    }
  });
});

test("the library ships no generic fade", () => {
  // The brief was explicit: real short-form styles, not fade in / slide up.
  // Two deliberate exceptions: "No Animation" is the off switch, and
  // Typewriter is opacity-only by definition — but it must be a hard CUT, not
  // a fade, which is what its zero-influence easing enforces.
  LIBRARY.animations.forEach((animation) => {
    if (animation.id === "none" || !animation["in"]) return;
    const types = animation["in"].properties.map((p) => p.type);
    if (types.filter((t) => t !== "opacity").length > 0) return;
    const ease = animation["in"].ease || {};
    assert.strictEqual(
      (ease["in"] || 0) + (ease.out || 0), 0,
      animation.id + " animates opacity alone with easing — that is a fade"
    );
  });
});

test("every animation declares what it is for", () => {
  LIBRARY.animations.forEach((animation) => {
    assert.ok(animation.name, animation.id + " has no name");
    assert.ok(animation.description, animation.id + " has no description");
    assert.ok(animation.basedOn, animation.id + " has no selector basis");
  });
});

test("no animation still references a preview video", () => {
  // Previews are rendered live now. A leftover `preview` field would point at
  // a file the build never produces.
  LIBRARY.animations.forEach((animation) => {
    assert.strictEqual(animation.preview, undefined,
                       animation.id + " still points at a baked preview file");
  });
});

// --- the preview must not promise motion the host will not produce ----------
//
// The grid showing one animation while After Effects renders another is the
// exact failure that let the range-selector bug go unnoticed: the cards looked
// right, so the library looked fine. These pin the two implementations
// together at the points where they could drift.

test("the preview's spring matches the host's spring keys", () => {
  const { load } = require("./jsx-host.js");
  const spec = {
    type: "scale", from: [0, 0], to: [100, 100],
    overshoot: 1.15, bounces: 3, damping: 0.5
  };

  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [{ text: "p", start: 0, end: 2,
      timings: { inStart: 0, inDuration: 1.0, outStart: 2, outDuration: 0 } }],
    style: {}, options: {},
    animation: { id: "t", basedOn: "characters", in: { properties: [spec] } }
  });

  const layers = [];
  for (let i = 1; i <= h.comp.numLayers; i++) layers.push(h.comp.layer(i));
  const cap = layers.find((l) => /^Capset__cap/.test(l.name));
  const animators = cap.property("ADBE Text Properties").property("ADBE Text Animators");
  let animator = null;
  for (let i = 1; i <= animators.numProperties; i++) {
    if (/__in$/.test(animators.property(i).name)) animator = animators.property(i);
  }
  const prop = animator.property("ADBE Text Animator Properties").property(1);

  const stops = preview.springStops(spec.from, spec.to, spec.overshoot,
                                    spec.bounces, spec.damping);

  assert.strictEqual(prop.numKeys, stops.length,
    "the preview and the host disagree on how many stops the spring has");

  stops.forEach((stop, i) => {
    // The phase runs 0->1.0s, so key times are already normalised.
    assert.ok(Math.abs(prop.keyTime(i + 1) - stop.at) < 1e-6,
      "stop " + i + " is at " + prop.keyTime(i + 1) + " in the host, " +
      stop.at + " in the preview");
    const hostValue = prop.keyValue(i + 1)[0];
    const previewValue = Array.isArray(stop.value) ? stop.value[0] : stop.value;
    assert.ok(Math.abs(hostValue - previewValue) < 1e-6,
      "stop " + i + " is " + hostValue + " in the host, " + previewValue +
      " in the preview");
  });
});

test("a plain overshoot is still a single peak in both", () => {
  // Existing presets declare `overshoot` with no bounces; they must keep the
  // shape they had rather than quietly becoming springs.
  const stops = preview.springStops([0, 0], [100, 100], 1.15, undefined, undefined);
  assert.strictEqual(stops.length, 3, "from, one peak, and the target");
  assert.ok(Math.abs(stops[1].value[0] - 115) < 1e-9);
});

test("the tuning bench computes the same spring as the panel", () => {
  // tools/animation-tuner.html carries its own copy of the spring maths so it
  // can be opened as a single file. A copy that drifts is a bench that lies
  // about what After Effects will do -- which is the failure this whole suite
  // exists to prevent, so the copy is checked against the original.
  const html = fs.readFileSync(
    path.join(__dirname, "..", "tools", "animation-tuner.html"), "utf8"
  );
  const consts = html.slice(html.indexOf("var OVERSHOOT_PEAK"), html.indexOf("var REST = {"));
  const body = html.slice(html.indexOf("function lerp("), html.indexOf("function clamp01("));
  const bench = new Function(consts + body + "; return { springStops: springStops };")();

  const cases = [
    [[0, 0], [100, 100], 1.15, 3, 0.45],
    [[12, 12], [100, 100], 1.15, 3, 0.45],
    [[0, -74], [0, 0], 1.30, 3, 0.5],
    [8, 0, 1.2, 4, 0.55],
    [[80, 80], [100, 100], 1.12, undefined, undefined],
    [[138, 62], [100, 100], 1.16, 3, 0.5]
  ];

  cases.forEach(([from, to, overshoot, bounces, damping]) => {
    assert.deepStrictEqual(
      bench.springStops(from, to, overshoot, bounces, damping),
      preview.springStops(from, to, overshoot, bounces, damping),
      "the bench and the panel disagree for overshoot " + overshoot
    );
  });
});

test("the tuning bench offers every preset in the library", () => {
  // A bench missing a preset is a preset nobody can tune.
  const html = fs.readFileSync(
    path.join(__dirname, "..", "tools", "animation-tuner.html"), "utf8"
  );
  const library = require("../animations/animations.json");
  library.animations.forEach((animation) => {
    if (animation.id === "none") return;
    assert.ok(
      html.includes('"' + animation.id + '"'),
      animation.id + " is in the library but not in the bench"
    );
  });
});
