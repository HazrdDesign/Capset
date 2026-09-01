/**
 * Executes panel/jsx/capset.jsx against the fake host in tests/fake-ae.js.
 *
 * These are not a substitute for running the panel in After Effects, and the
 * fake cannot tell you whether a match name is real. They cover the bugs that
 * need no host to be wrong, and each one below was written after watching the
 * real code produce the wrong answer.
 */
const test = require("node:test");
const assert = require("node:assert");
const { load } = require("./jsx-host.js");

const CAPTIONS = [
  { text: "first caption", start: 0.0, end: 1.2 },
  { text: "second caption", start: 1.2, end: 2.5 },
  { text: "third caption", start: 2.5, end: 4.0 }
];

const names = (comp) => comp.layers._layers.map((l) => l.name);
// Arrays built inside the sandbox have that realm's Array prototype, so
// deepStrictEqual rejects them on identity alone. Copy before comparing.
const plain = (arr) => Array.prototype.slice.call(arr);
const captionLayers = (comp) =>
  comp.layers._layers.filter((l) => l.name.indexOf("Capset__cap") === 0);

// --- building ---------------------------------------------------------------

test("captions become layers at the times they were given", () => {
  const h = load();
  const result = h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  assert.strictEqual(result.created, 3);

  const layers = captionLayers(h.comp).sort((a, b) => a.inPoint - b.inPoint);
  assert.deepStrictEqual(
    layers.map((l) => [+l.inPoint.toFixed(3), +l.outPoint.toFixed(3)]),
    [[0, 1.2], [1.2, 2.5], [2.5, 4]]
  );
});

test("layer times snap to whole frames", () => {
  // Sub-frame in and out points make captions appear a frame late in render.
  const h = load({ frameRate: 25 });
  h.call("capsetBuildCaptions", {
    captions: [{ text: "x", start: 0.417, end: 1.031 }], style: {}, options: {}
  });
  const layer = captionLayers(h.comp)[0];
  const frame = 1 / 25;
  assert.ok(Math.abs(layer.inPoint / frame - Math.round(layer.inPoint / frame)) < 1e-9);
  assert.ok(Math.abs(layer.outPoint / frame - Math.round(layer.outPoint / frame)) < 1e-9);
});

test("multi-line captions are joined with a carriage return", () => {
  // ExtendScript text layers use \r, not \n; \n renders as a visible box.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [{ lines: ["top line", "bottom line"], start: 0, end: 2 }],
    style: {}, options: {}
  });
  const doc = captionLayers(h.comp)[0].property("Source Text").value;
  assert.strictEqual(doc.text, "top line\rbottom line");
});

test("an empty caption list is refused rather than silently doing nothing", () => {
  const h = load();
  assert.throws(() => h.call("capsetBuildCaptions", { captions: [], style: {}, options: {} }),
                /No captions/);
});

test("title-safe raises the baseline out of the overscan region", () => {
  const safe = load();
  safe.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: { titleSafe: true }, options: {}
  });
  const unsafe = load();
  unsafe.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: { titleSafe: false }, options: {}
  });
  const y = (h) => captionLayers(h.comp)[0].property("Transform").property("Position").value[1];
  assert.ok(y(safe) < y(unsafe), "title-safe captions must sit higher in frame");
});

// --- rebuilding -------------------------------------------------------------

test("running Add Captions twice replaces rather than stacks", () => {
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const second = h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  assert.strictEqual(second.replaced, 3);
  assert.strictEqual(captionLayers(h.comp).length, 3);
});

test("a rebuild replaces precomposed captions too", () => {
  // precompose() returns the new COMPOSITION, so naming its result renamed the
  // project item and left the timeline layer called "Capset Captions" — which
  // carries no Capset prefix, so the next run could not find it. Two runs left
  // two stacked precomps fighting over the same frames.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  const second = h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  assert.strictEqual(second.replaced, 1, "the existing precomp was not removed");
  assert.strictEqual(h.comp.numLayers, 1, "captions stacked: " + names(h.comp).join(", "));
});

test("a rebuild does not orphan the precomposition in the project panel", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  const leftovers = h.fake.project.items.filter((i) => i.name.indexOf("Capset__") === 0);
  assert.strictEqual(leftovers.length, 1,
    "dead precomps accumulate in the project panel: " +
    h.fake.project.items.map((i) => i.name).join(", "));
});

test("the precomposed layer carries the Capset prefix", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  const layer = h.comp.layers._layers[0];
  assert.ok(layer.name.indexOf("Capset__") === 0,
            "precomposed layer is named " + layer.name);
});

test("a rebuild leaves the controller alone", () => {
  // Removing it would drop the user's slider values and unparent everything.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  const before = h.comp.layers._layers.find((l) => l.name === "Capset Controller");
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  const after = h.comp.layers._layers.find((l) => l.name === "Capset Controller");
  assert.strictEqual(after.id, before.id, "the controller was rebuilt");
});

// --- controller -------------------------------------------------------------

test("captions are parented to the controller", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  const controller = h.comp.layers._layers.find((l) => l.name === "Capset Controller");
  captionLayers(h.comp).forEach((l) => {
    assert.strictEqual(l.parent, controller, l.name + " is not parented");
  });
});

test("the controller's sliders actually drive the captions", () => {
  // The controller was created with Font Size and Fill Colour sliders but the
  // expressions reading them were only ever written by a separate entry point
  // nothing called. The sliders sat there doing nothing.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  captionLayers(h.comp).forEach((l) => {
    const expr = l.property("Source Text").expression;
    assert.match(expr, /Capset Controller/, l.name + " has no link to the controller");
    assert.match(expr, /Font Size/);
  });
});

test("no controller is created when the option is off", () => {
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  assert.ok(!h.comp.layers._layers.some((l) => l.name === "Capset Controller"));
  captionLayers(h.comp).forEach((l) => assert.strictEqual(l.parent, null));
});

// --- style capture and sync -------------------------------------------------

function captureFrom(h) {
  const source = captionLayers(h.comp)[0];
  source.selected = true;
  return h.call("capsetCaptureStyle");
}

test("capture records the comp it came from, so position can be scaled", () => {
  // applyStyleToLayer positions proportionally and skips entirely without
  // these, so every synced caption kept its old position and the feature
  // looked like it simply did not work.
  const h = load({ width: 1080, height: 1920 });
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const captured = captureFrom(h);
  assert.strictEqual(captured.style.sourceWidth, 1080);
  assert.strictEqual(captured.style.sourceHeight, 1920);
});

test("synced position is proportional to the target comp", () => {
  const h = load({ width: 1000, height: 1000 });
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const captured = captureFrom(h);
  captured.style.position = [500, 800];        // dead centre, 80% down

  const target = load({ width: 2000, height: 500 });
  target.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  target.call("capsetSyncStyle", { style: captured.style, scope: "comp" });

  const pos = captionLayers(target.comp)[0].property("Transform").property("Position").value;
  assert.deepStrictEqual(plain(pos), [1000, 400]);
});

test("sync applies the captured type settings", () => {
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const captured = captureFrom(h);
  captured.style.fontSize = 120;
  captured.style.tracking = 40;

  h.call("capsetSyncStyle", { style: captured.style, scope: "comp" });
  captionLayers(h.comp).forEach((l) => {
    const doc = l.property("Source Text").value;
    assert.strictEqual(doc.fontSize, 120);
    assert.strictEqual(doc.tracking, 40);
  });
});

test("sync copies effects when asked", () => {
  // The panel sent copyEffects and the host never read it, so the checkbox
  // was decorative.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const source = captionLayers(h.comp)[0];
  source.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
  const captured = captureFrom(h);

  h.call("capsetSyncStyle", {
    style: captured.style,
    effects: captured.effects,
    copyEffects: true,
    scope: "comp",
    sourceLayerIndex: captured.sourceLayerIndex,
    sourceCompName: captured.sourceCompName
  });
  assert.ok(h.fake.commandLog.length > 0, "no copy/paste was ever issued");
});

test("sync leaves effects alone when not asked", () => {
  // Clipboard commands are disruptive and slow; they must not run by default.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const source = captionLayers(h.comp)[0];
  source.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
  const captured = captureFrom(h);

  h.call("capsetSyncStyle", { style: captured.style, copyEffects: false, scope: "comp" });
  assert.deepStrictEqual(h.fake.commandLog, []);
});

test("sync restores the selection it borrowed", () => {
  // Copying effects drives the clipboard through menu commands, which means
  // hijacking the selection. Leaving the user's selection changed after a
  // sync is its own bug report.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const source = captionLayers(h.comp)[0];
  source.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
  const captured = captureFrom(h);

  const chosen = captionLayers(h.comp)[2];
  h.comp.layers._layers.forEach((l) => { l.selected = false; });
  chosen.selected = true;

  h.call("capsetSyncStyle", {
    style: captured.style, effects: captured.effects, copyEffects: true, scope: "comp",
    sourceLayerIndex: captured.sourceLayerIndex, sourceCompName: captured.sourceCompName
  });
  assert.deepStrictEqual(
    h.comp.selectedLayers.map((l) => l.name), [chosen.name],
    "the selection was left where sync put it"
  );
});

test("sync with nothing to style says so", () => {
  const h = load();
  assert.throws(() => h.call("capsetSyncStyle", { style: { fontSize: 10 }, scope: "comp" }),
                /No Capset caption layers/);
});

test("sync without a captured style refuses", () => {
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  assert.throws(() => h.call("capsetSyncStyle", { scope: "comp" }), /No captured style/);
});

// --- clearing ---------------------------------------------------------------

test("clear removes captions and the controller", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  const result = h.call("capsetClearCaptions", { removeController: true });
  assert.strictEqual(result.removed, 4);
  assert.strictEqual(h.comp.numLayers, 0);
});

test("clear can keep the controller", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  h.call("capsetClearCaptions", { removeController: false });
  assert.deepStrictEqual(names(h.comp), ["Capset Controller"]);
});

test("clear leaves layers that are not Capset's", () => {
  const h = load();
  h.comp.layers.addText("someone else's title");
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  h.call("capsetClearCaptions", { removeController: true });
  assert.deepStrictEqual(names(h.comp), ["someone else's title"]);
});

// --- animation --------------------------------------------------------------

test("an animation adds prefixed text animators", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [{
      text: "x", start: 0, end: 2,
      timings: { inStart: 0, inDuration: 0.3, outStart: 1.7, outDuration: 0.3 }
    }],
    style: {},
    animation: {
      id: "fade",
      basedOn: "words",
      in: { properties: [{ type: "opacity", from: 0, to: 100 }] },
      out: { properties: [{ type: "opacity", from: 100, to: 0 }] }
    },
    options: {}
  });
  const animators = captionLayers(h.comp)[0]
    .property("ADBE Text Properties").property("ADBE Text Animators");
  assert.ok(animators.numProperties >= 1, "no animators were created");
  for (let i = 1; i <= animators.numProperties; i++) {
    assert.ok(animators.property(i).name.indexOf("Capset__") === 0,
              "an animator without the prefix cannot be cleanly removed later");
  }
});

test("swapping animation removes the previous one rather than layering it", () => {
  const h = load();
  const payload = {
    captions: [{
      text: "x", start: 0, end: 2,
      timings: { inStart: 0, inDuration: 0.3, outStart: 1.7, outDuration: 0.3 }
    }],
    style: {},
    animation: {
      id: "fade",
      basedOn: "words",
      in: { properties: [{ type: "opacity", from: 0, to: 100 }] }
    },
    options: {}
  };
  h.call("capsetBuildCaptions", payload);
  const layer = captionLayers(h.comp)[0];
  const animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
  const first = animators.numProperties;

  h.call("capsetReplaceAnimation", {
    scope: "all",
    animation: {
      id: "pop",
      basedOn: "characters",
      in: { properties: [{ type: "scale", from: [0, 0], to: [100, 100] }] }
    },
    timingsById: {}
  });
  assert.strictEqual(animators.numProperties, first,
                     "animators accumulated across a swap");
});

test("an unsupported animator property is skipped, not fatal", () => {
  const h = load();
  const result = h.call("capsetBuildCaptions", {
    captions: [{
      text: "x", start: 0, end: 2,
      timings: { inStart: 0, inDuration: 0.3, outStart: 1.7, outDuration: 0.3 }
    }],
    style: {},
    animation: { id: "bogus", in: { properties: [{ type: "notARealProperty", from: 0, to: 1 }] } },
    options: {}
  });
  assert.strictEqual(result.created, 1);
});
