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
// Caption layers are found the way the host script finds them: by the tag in
// the comment field. Filtering on a name prefix would be testing an
// implementation detail that no longer exists — the name is the caption's
// text now, and a user is free to change it.
const CAPSET_TAG = "Capset caption";
const captionLayers = (comp) =>
  comp.layers._layers.filter((l) => l.comment === CAPSET_TAG);

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

test("captions land centred, in the subtitle band, whatever is passed", () => {
  // This used to be a "Keep inside title-safe" checkbox picking between two
  // baselines, and it could not do what it said: the text block's size comes
  // from the user's Character panel settings, which is the whole point of
  // inheriting them, so moving the anchor cannot keep type of an unknown size
  // inside a safe area. One position, always, and no control claiming
  // otherwise.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const position = (layer) =>
    plain(layer.property("Transform").property("Position").value);

  captionLayers(h.comp).forEach((layer) => {
    const [x, y] = position(layer);
    assert.strictEqual(x, h.comp.width * 0.5, "captions must be centred");
    assert.ok(y > h.comp.height * 0.78 && y < h.comp.height * 0.92,
              "captions must sit in the subtitle band, not at " + y);
  });

  // A stale style object from an older project must not move them.
  const legacy = load();
  legacy.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: { titleSafe: false }, options: {}
  });
  assert.deepStrictEqual(position(captionLayers(legacy.comp)[0]),
                         position(captionLayers(h.comp)[0]));
});

test("an explicit positionY still wins, because Sync Style sends one", () => {
  // The Update tab captures a layer's position and pushes it to the rest. If
  // the baseline overrode that, moving one caption and syncing would snap it
  // back to where it started.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: { positionY: 0.5 }, options: {}
  });
  const y = captionLayers(h.comp)[0]
    .property("Transform").property("Position").value[1];
  assert.strictEqual(y, h.comp.height * 0.5);
});

test("a caption layer is named after what it says", () => {
  // The timeline should read like the transcript. It used to read
  // Capset__cap_1, Capset__cap_2, Capset__cap_3 — serial numbers for layers
  // whose whole content is a line of text.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [
      { text: "Hi everyone.", start: 0, end: 1 },
      { lines: ["Welcome back to", "the channel."], start: 1, end: 2.5 }
    ],
    style: {}, options: {}
  });

  const layers = captionLayers(h.comp).sort((a, b) => a.inPoint - b.inPoint);
  assert.strictEqual(layers[0].name, "Hi everyone.");
  // A layer name is one line: the carriage return that separates the lines in
  // the text itself would render as a control character in the timeline.
  assert.strictEqual(layers[1].name, "Welcome back to the channel.");
});

test("a caption layer is recognised by its tag, not its name", () => {
  // The name is prose now, so a user can rename a layer without Capset losing
  // track of it — Sync Style must still find it, and a rebuild must still
  // replace it rather than stacking a second set on top.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });

  const renamed = captionLayers(h.comp)[0];
  renamed.name = "my favourite line";

  const second = h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  assert.strictEqual(second.replaced, 3, "a renamed caption was not recognised");
  assert.strictEqual(captionLayers(h.comp).length, 3);
});

test("captions built before the tag existed are still recognised", () => {
  // Every project already out there names its captions Capset__cap_N and has
  // no comment on them. Dropping the name check would orphan all of them.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  captionLayers(h.comp).forEach((layer, i) => {
    layer.comment = "";
    layer.name = "Capset__cap_" + (i + 1);
  });

  const second = h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  assert.strictEqual(second.replaced, 3, "legacy caption layers were orphaned");
});

// --- the controller rig -----------------------------------------------------

/**
 * Evaluate an After Effects expression and return its value.
 *
 * An expression's result is the completion value of its last statement, which
 * is exactly what JavaScript's `eval` returns — so the real expression text
 * runs here, branches and all, rather than being pattern-matched. That
 * matters: this expression shipped computing the right number in the wrong
 * coordinate space, and no amount of reading it for keywords would have
 * caught that.
 */
function evaluateExpression(expression, scope) {
  return Function(
    "thisComp", "hasParent", "parent", "value",
    "return eval(" + JSON.stringify(expression) + ");"
  )(scope.thisComp, scope.hasParent, scope.parent, scope.value);
}

/** A null as addNull() makes one: anchor at its top-left, sitting at centre. */
function centredNull(comp, baselinePercent) {
  const position = [comp.width / 2, comp.height / 2];
  return {
    position: position,
    effect: () => () => baselinePercent,
    // Comp space to this layer's space. With the anchor at [0,0] that is a
    // straight subtraction of where the null sits.
    fromComp: (p) => [p[0] - position[0], p[1] - position[1]]
  };
}

test("a caption parented to the controller stays in frame", () => {
  // It did not. Position is measured in the PARENT'S space once a layer is
  // parented, and the expression computed a point in COMP space — so every
  // caption was drawn half a comp width right and half a comp height down of
  // where it belonged, which on any comp is off the bottom-right corner.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });

  const layer = captionLayers(h.comp)[0];
  const expression = layer.property("Transform").property("Position").expression;
  assert.ok(expression, "no position expression was written");

  const comp = { width: h.comp.width, height: h.comp.height, layer: () => null };
  const controller = centredNull(h.comp, 85);
  comp.layer = () => controller;

  const local = evaluateExpression(expression, {
    thisComp: comp, hasParent: true, parent: controller, value: [0, 0]
  });
  // Parented: the layer's world position is the null's plus its own.
  const world = [local[0] + controller.position[0], local[1] + controller.position[1]];

  assert.deepStrictEqual(world, [comp.width / 2, comp.height * 0.85]);
  assert.ok(world[0] < comp.width && world[1] < comp.height,
            "the caption is outside the composition at " + world);
});

test("the same expression is still correct on an unparented layer", () => {
  // Someone will unparent a caption from the controller. The expression stays
  // on the layer when they do, and must not then subtract a null that is no
  // longer above it.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  const expression = captionLayers(h.comp)[0]
    .property("Transform").property("Position").expression;

  const comp = { width: 1080, height: 1920, layer: () => null };
  const controller = centredNull(comp, 85);
  comp.layer = () => controller;

  const world = evaluateExpression(expression, {
    thisComp: comp, hasParent: false, parent: null, value: [0, 0]
  });
  assert.deepStrictEqual(world, [540, 1632]);
});

test("the controller's baseline slider starts where the captions already are", () => {
  // The slider defaulted to 82 while layers were built at 85, so ticking
  // Parent to Controller shifted every caption up by 3% of the comp for no
  // reason the user asked for.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { parentToController: true }
  });
  const controller = h.comp.layers._layers.find((l) => l.name === "Capset Controller");
  assert.ok(controller, "no controller was created");

  const slider = controller.property("ADBE Effect Parade")
    .property("Baseline %").property("ADBE Slider Control-0001").value;

  const unparented = load();
  unparented.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const y = captionLayers(unparented.comp)[0]
    .property("Transform").property("Position").value[1];

  assert.strictEqual(slider / 100, y / unparented.comp.height);
});

test("a captured baseline still drives the controller", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: { positionY: 0.6 }, options: { parentToController: true }
  });
  const controller = h.comp.layers._layers.find((l) => l.name === "Capset Controller");
  const slider = controller.property("ADBE Effect Parade")
    .property("Baseline %").property("ADBE Slider Control-0001").value;
  assert.strictEqual(slider, 60);
});

// --- SRT export -------------------------------------------------------------

test("export reads the captions off the timeline", () => {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [
      { text: "Second.", start: 2, end: 3 },
      { text: "First.", start: 0, end: 1 }
    ],
    style: {}, options: {}
  });

  const data = h.call("capsetCaptionsForExport");
  assert.strictEqual(data.comp, h.comp.name);
  const texts = plain(data.captions).map((c) => c.text).sort();
  assert.deepStrictEqual(texts, ["First.", "Second."]);
});

test("export reflects a caption the user retimed or retyped", () => {
  // The reason it reads the timeline rather than remembering the transcript.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });

  const layer = captionLayers(h.comp).sort((a, b) => a.inPoint - b.inPoint)[0];
  layer.outPoint = 9;
  const prop = layer.property("Source Text");
  const doc = prop.value;
  doc.text = "corrected text";
  prop.setValue(doc);

  const captions = plain(h.call("capsetCaptionsForExport").captions);
  const edited = captions.filter((c) => c.text === "corrected text");
  assert.strictEqual(edited.length, 1, "the edit did not reach the export");
  assert.strictEqual(edited[0].end, 9);
});

test("export descends into precomposed captions and shifts their times", () => {
  // Precompose is an option on the Insert tab, and inside a precomp a caption
  // at 2s may sit anywhere in the outer comp. An SRT that reported the inner
  // time would be wrong for every caption in the file.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  const precomp = h.comp.layers._layers.find((l) => l.source);
  assert.ok(precomp, "nothing was precomposed");
  precomp.startTime = 10;

  const captions = plain(h.call("capsetCaptionsForExport").captions)
    .sort((a, b) => a.start - b.start);
  assert.deepStrictEqual(
    captions.map((c) => +c.start.toFixed(3)),
    [10, 11.2, 12.5]
  );
});

test("exporting with no captions says so rather than writing an empty file", () => {
  const h = load();
  assert.throws(() => h.call("capsetCaptionsForExport"), /No Capset captions/);
});

test("the SRT lands in a Capset SRT folder beside the project", () => {
  const h = load();
  const result = h.call("capsetWriteSrt", { text: "1\r\n...\r\n", name: "Comp 1" });
  assert.strictEqual(result.path, "/projects/Capset SRT/Comp 1.srt");
  assert.strictEqual(h.fake.writtenText.get(result.path), "1\r\n...\r\n");
  assert.ok(h.fake.existingFolders.has("/projects/Capset SRT"),
            "the folder was not created");
});

test("an unsaved project is refused with something the user can act on", () => {
  const h = load({ projectFile: null });
  assert.throws(() => h.call("capsetWriteSrt", { text: "x", name: "Comp 1" }),
                /Save the After Effects project first/);
});

test("a comp name that is not a legal filename is made into one", () => {
  const h = load();
  const result = h.call("capsetWriteSrt", { text: "x", name: 'Ep 3: "final"/v2 ' });
  // A run of illegal characters collapses to one dash, and the trailing
  // space goes: Windows rejects a name ending in a space or a dot.
  assert.strictEqual(result.path, "/projects/Capset SRT/Ep 3- -final-v2.srt");
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

test("a work-area rebuild leaves captions outside it alone", () => {
  // The reported behaviour: set in and out points to redo one line word by
  // word, and every caption outside them was thrown away too — including the
  // pass you were keeping.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });

  const second = h.call("capsetBuildCaptions", {
    captions: [{ text: "redone", start: 1.3, end: 2.4 }],
    style: {}, options: {},
    replaceRange: { start: 1.2, duration: 1.3 }        // the middle caption
  });

  assert.strictEqual(second.replaced, 1, "it reached outside the range");
  assert.deepStrictEqual(
    captionLayers(h.comp).map((l) => l.name).sort(),
    ["first caption", "redone", "third caption"]
  );
});

test("a caption that merely touches the range is not replaced", () => {
  // Captions sit end to end now that each is held until the next arrives, so
  // one out point IS the next in point. Counting a touch as an overlap would
  // take the neighbour on each side of every range.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const second = h.call("capsetBuildCaptions", {
    captions: [{ text: "redone", start: 1.3, end: 2.4 }],
    style: {}, options: {},
    // Exactly the middle caption's span: [1.2, 2.5]. Its neighbours end at
    // 1.2 and begin at 2.5.
    replaceRange: { start: 1.2, duration: 1.3 }
  });
  assert.strictEqual(second.replaced, 1,
    "replaced " + second.replaced + ", so a touching neighbour was taken");
});

test("a caption straddling the range edge is replaced", () => {
  // Leaving it would put two captions on screen at once, which is worse than
  // replacing slightly more than was asked for.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [{ text: "straddler", start: 0.0, end: 2.0 }], style: {}, options: {}
  });
  const second = h.call("capsetBuildCaptions", {
    captions: [{ text: "redone", start: 1.5, end: 3.0 }],
    style: {}, options: {},
    replaceRange: { start: 1.5, duration: 1.5 }
  });
  assert.strictEqual(second.replaced, 1);
});

test("a whole-composition rebuild still replaces everything", () => {
  // No range means no scoping: the behaviour every existing run depends on.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const second = h.call("capsetBuildCaptions", {
    captions: [{ text: "redone", start: 1.3, end: 2.4 }], style: {}, options: {}
  });
  assert.strictEqual(second.replaced, 3);
  assert.strictEqual(second.ranged, false);
  assert.strictEqual(captionLayers(h.comp).length, 1);
});

test("a work-area rebuild says when a precomp forced its hand", () => {
  // A range cannot reach inside a precomp — the captions there are layers of
  // another composition — so removing the layer takes the ones outside the
  // range with it. That must not happen quietly.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: CAPTIONS, style: {}, options: { precompose: true }
  });
  const second = h.call("capsetBuildCaptions", {
    captions: [{ text: "redone", start: 1.3, end: 2.4 }],
    style: {}, options: {},
    replaceRange: { start: 1.2, duration: 1.3 }
  });
  assert.strictEqual(second.precompOverrun, true,
    "captions outside the work area were lost with nothing said");
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

// --- audio render -----------------------------------------------------------

function withAudio(h, name = "voiceover") {
  const layer = h.comp.layers.addText(name);
  layer.hasAudio = true;
  return layer;
}

function queueSomethingOfTheirOwn(h, name = "Final Delivery 4K") {
  const comp = new h.fake.CompItem(name, 3840, 2160, 600, 24);
  h.fake.project.items.push(comp);
  return h.fake.project.renderQueue.items.add(comp);
}

test("rendering audio renders only our composition", () => {
  // renderQueue.render() renders EVERY enabled item, not the one just added.
  // Hitting Add Captions with a delivery queued would start that delivery:
  // hours of machine time and an overwritten output file, from a button that
  // says "Add Captions".
  const h = load();
  withAudio(h);
  const theirs = queueSomethingOfTheirOwn(h);

  h.call("capsetRenderAudio", { scope: "composition" });

  const rendered = h.fake.project.renderQueue.rendered.map((i) => i.comp.name);
  assert.deepStrictEqual(rendered, ["Comp 1"]);
  assert.strictEqual(theirs.status, "queued", "the user's render was started");
});

test("the user's render queue is left exactly as it was", () => {
  // Leaving their queue disabled is a silent failure they discover hours
  // later, when the overnight render turns out not to have run.
  const h = load();
  withAudio(h);
  const enabled = queueSomethingOfTheirOwn(h, "Delivery A");
  const disabled = queueSomethingOfTheirOwn(h, "Delivery B");
  disabled.render = false;

  h.call("capsetRenderAudio", { scope: "composition" });

  assert.strictEqual(enabled.render, true, "an enabled item was left disabled");
  assert.strictEqual(disabled.render, false, "a disabled item was switched on");
});

test("the queue is restored even when the render fails", () => {
  const h = load({ templates: ["Lossless", "High Quality"] });  // no audio template
  withAudio(h);
  const theirs = queueSomethingOfTheirOwn(h);

  assert.throws(() => h.call("capsetRenderAudio", { scope: "composition" }),
                /output module template/);
  assert.strictEqual(theirs.render, true);
});

test("our render queue item is removed afterwards", () => {
  // Otherwise every Add Captions leaves another dead entry in their queue.
  const h = load();
  withAudio(h);
  h.call("capsetRenderAudio", { scope: "composition" });
  assert.strictEqual(h.fake.project.renderQueue.numItems, 0);
});

test("an AIFF-only install still renders", () => {
  // A stock After Effects has "AIFF 48kHz" and may have no WAV template at
  // all, so AIFF is a likely path rather than an edge case.
  const h = load({ templates: ["Lossless", "AIFF 48kHz"] });
  withAudio(h);
  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.strictEqual(result.template, "AIFF 48kHz");
  assert.match(result.path, /\.aif$/);
});

test("an AIFF template found by the generic fallback is still named .aif", () => {
  // The extension used to come from WHICH pattern matched rather than from the
  // template's own name, so anything caught by the generic /audio/i fallback
  // was called .wav no matter what it actually wrote.
  const h = load({ templates: ["Lossless", "Audio Only AIFF"] });
  withAudio(h);
  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.strictEqual(result.template, "Audio Only AIFF");
  assert.match(result.path, /\.aif$/, "an AIFF template should not be named .wav");
});

test("no audio template at all is explained, not swallowed", () => {
  const h = load({ templates: ["Lossless", "High Quality"] });
  withAudio(h);
  assert.throws(() => h.call("capsetRenderAudio", { scope: "composition" }),
                /set Format to WAV or AIFF/);
});

// --- a render that produced no samples --------------------------------------
//
// The failure that reached a real user: After Effects rendered a valid,
// openable audio file with nothing in it, the backend transcribed the silence,
// and the panel reported "0 words -> 0 captions". Nothing in the chain
// objected. The render is where this is cheapest to catch -- before an upload
// and a transcription that were never going to find anything.

test("a header-only render is rejected before anything is uploaded", () => {
  // Render Settings with Audio Output off still writes a file: a WAV header
  // and no samples after it.
  const h = load({ renderedBytes: 44 });
  withAudio(h);
  assert.throws(() => h.call("capsetRenderAudio", { scope: "composition" }),
                /empty audio file/);
});

test("the empty-render message names the setting to change", () => {
  // "Something went wrong" costs the user an evening; naming the switch does
  // not. This is the whole point of catching it here.
  const h = load({ renderedBytes: 44 });
  withAudio(h);
  assert.throws(() => h.call("capsetRenderAudio", { scope: "composition" }),
                /Audio Output/);
});

test("a real render reports its size so the panel can show it", () => {
  const h = load();
  withAudio(h);
  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.ok(result.bytes > 128, "a real render is far larger than a header");
});

test("an unknown file size does not block a render", () => {
  // File.length is -1 when ExtendScript cannot stat the file. That is not
  // evidence of an empty render, and treating it as one would break a working
  // install over a missing number.
  const h = load();
  withAudio(h);
  const file = h.sandbox.File;
  Object.defineProperty(file.prototype, "length", {
    configurable: true, get() { return -1; }
  });
  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.ok(result.path, "the render should still succeed");
});

test("the output file is set on the output module that actually renders", () => {
  // Applying a template invalidates the OutputModule object: a reference taken
  // before applyTemplate() is stale afterwards, and assigning .file on it
  // sends the render somewhere we never look. The fake replaces the module on
  // applyTemplate, exactly as After Effects does, so a script that holds the
  // stale reference renders no file and this fails.
  const h = load();
  withAudio(h);
  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.ok(result.path, "the render produced no file: .file was set on a stale module");
  assert.ok(h.fake.writtenFiles.has(result.path), "the rendered path was not written");
});

test("a composition with no audible layer says so", () => {
  const h = load();
  h.comp.layers.addText("just a title");
  assert.throws(() => h.call("capsetRenderAudio", { scope: "composition" }),
                /No audible audio/);
});

test("the work area is restored after a full-composition render", () => {
  // Silently moving the user's work area would be rude and hard to notice.
  const h = load();
  withAudio(h);
  h.comp.workAreaStart = 4;
  h.comp.workAreaDuration = 6;

  h.call("capsetRenderAudio", { scope: "composition" });

  assert.strictEqual(h.comp.workAreaStart, 4);
  assert.strictEqual(h.comp.workAreaDuration, 6);
});

test("an in-to-out render reports the work area's bounds", () => {
  const h = load();
  withAudio(h);
  h.comp.workAreaStart = 4;
  h.comp.workAreaDuration = 6;

  const result = h.call("capsetRenderAudio", { scope: "inout" });
  assert.strictEqual(result.start, 4);
  assert.strictEqual(result.duration, 6);
});

// --- overshoot --------------------------------------------------------------
//
// `overshoot` sat in every animation definition and nothing read it, so the
// library's "Pop In" and "Bounce" were plain interpolations. It is the whole
// difference between a CapCut-style punch and a fade.

function animate(h, animation, duration = 2) {
  h.call("capsetBuildCaptions", {
    captions: [{
      text: "word", start: 0, end: duration,
      timings: { inStart: 0, inDuration: 0.4, outStart: duration - 0.3, outDuration: 0.3 }
    }],
    style: {}, animation, options: {}
  });
  const layer = captionLayers(h.comp)[0];
  const animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
  return { layer, animators };
}

function firstAnimatorProperty(animators) {
  return animators.property(1).property("ADBE Text Animator Properties").property(1);
}

// --- does the animation actually animate? -----------------------------------
//
// Everything below asserts MOTION, not construction. The tests above this
// point check that an animator was created carrying certain keyframes, which
// is not the same thing and is how a build shipped whose entrances barely
// moved: the range selector's offset swept -100 -> +100, so the animator's
// influence went 0% -> 100% -> 0% and the character sat at its natural pose
// at both ends of every phase. See tests/ae-text-animator.js.

const ae = require("./ae-text-animator.js");

/** The in-phase animator of a layer built by animate(). */
function inAnimator(animators) {
  for (let i = 1; i <= animators.numProperties; i++) {
    const a = animators.property(i);
    if (/__in$/.test(a.name)) return a;
  }
  throw new Error("no in-phase animator was created");
}

test("an entrance begins in its from-pose, not at rest", () => {
  // The whole point of an entrance. If the animator has no influence at the
  // start of the phase, the caption simply appears at full size and the
  // animation is decorative keyframes nothing reads.
  const h = load();
  const { layer, animators } = animate(h, {
    id: "pop",
    basedOn: "characters",
    in: { properties: [{ type: "scale", from: [58, 58], to: [100, 100] }] }
  });

  const animator = inAnimator(animators);
  const start = layer.inPoint;
  const scale = ae.effectiveValue(
    animator, "ADBE Text Scale 3D", start, 0, 4, [100, 100, 100]
  );

  assert.ok(
    scale[0] < 70,
    "at the first instant of the entrance the character should be near 58%, " +
    "not " + scale[0].toFixed(1) + "% -- the animator has no influence there"
  );
});

test("an entrance ends at rest", () => {
  const h = load();
  const { layer, animators } = animate(h, {
    id: "pop",
    basedOn: "characters",
    in: { properties: [{ type: "scale", from: [58, 58], to: [100, 100] }] }
  });

  const animator = inAnimator(animators);
  const end = layer.inPoint + 0.4;
  const scale = ae.effectiveValue(
    animator, "ADBE Text Scale 3D", end, 0, 4, [100, 100, 100]
  );

  assert.ok(
    Math.abs(scale[0] - 100) < 2,
    "the character should have settled at 100%, not " + scale[0].toFixed(1) + "%"
  );
});

test("an opacity entrance actually fades in", () => {
  // opacity 0 -> 100 with no influence at the start means the character is
  // fully visible on the first frame: there is no fade at all.
  const h = load();
  const { layer, animators } = animate(h, {
    id: "fade",
    basedOn: "characters",
    in: { properties: [{ type: "opacity", from: 0, to: 100 }] }
  });

  const animator = inAnimator(animators);
  const opacity = ae.effectiveValue(
    animator, "ADBE Text Opacity", layer.inPoint, 0, 4, 100
  );

  assert.ok(
    opacity < 30,
    "the first character should start near invisible, not at " +
    opacity.toFixed(1) + "%"
  );
});

test("characters do not all animate in lockstep", () => {
  // The reason to use a range selector at all. Two characters at opposite
  // ends of the word should be at different points of the entrance partway
  // through it.
  const h = load();
  const { layer, animators } = animate(h, {
    id: "pop",
    basedOn: "characters",
    in: { properties: [{ type: "scale", from: [58, 58], to: [100, 100] }] }
  });

  const animator = inAnimator(animators);
  const mid = layer.inPoint + 0.2;
  const first = ae.amountAt(animator, mid, 0, 4);
  const last = ae.amountAt(animator, mid, 3, 4);

  assert.notStrictEqual(
    +first.toFixed(3), +last.toFixed(3),
    "every character is being animated identically, so there is no stagger"
  );
});

test("an overshooting property passes its target before settling", () => {
  const h = load();
  const { animators } = animate(h, {
    id: "pop",
    in: { properties: [{ type: "scale", from: [40, 40], to: [100, 100], overshoot: 1.2 }] }
  });
  const prop = firstAnimatorProperty(animators);
  assert.strictEqual(prop.numKeys, 3, "overshoot needs a peak key between the two ends");

  const peak = plain(prop.keyValue(2));
  const settle = plain(prop.keyValue(3));
  assert.ok(peak[0] > settle[0], "the peak does not exceed the target");
  assert.deepStrictEqual(settle.slice(0, 2), [100, 100]);
});

test("overshoot is measured against travel, so it works towards zero", () => {
  // Scaling the TARGET would do nothing whenever the target is zero — which
  // is every position animation, the ones that most need the bounce.
  const h = load();
  const { animators } = animate(h, {
    id: "bounce",
    in: { properties: [{ type: "position", from: [0, -80], to: [0, 0], overshoot: 1.25 }] }
  });
  const prop = firstAnimatorProperty(animators);
  const peak = plain(prop.keyValue(2));
  assert.strictEqual(peak[1], 20, "travelled -80 -> 0 should overshoot to +20");
});

test("no overshoot means no extra keyframe", () => {
  const h = load();
  const { animators } = animate(h, {
    id: "plain",
    in: { properties: [{ type: "opacity", from: 0, to: 100 }] }
  });
  assert.strictEqual(firstAnimatorProperty(animators).numKeys, 2);
});

test("an overshoot settle is eased, not left linear", () => {
  // Easing the middle key instead would leave the settle linear, which reads
  // as a stutter at the end of the punch.
  const h = load();
  const { animators } = animate(h, {
    id: "pop",
    in: { properties: [{ type: "scale", from: [0, 0], to: [100, 100], overshoot: 1.15 }] }
  });
  const prop = firstAnimatorProperty(animators);
  assert.ok(prop.keys[0].easeIn, "the first key was not eased");
  assert.ok(prop.keys[2].easeIn, "the settle key was not eased");
});

test("colour and tracking are animatable", () => {
  // Colour is what a karaoke or Hormozi style is made of; without it the
  // library can only ever offer motion.
  const h = load();
  const { animators } = animate(h, {
    id: "karaoke",
    in: {
      properties: [
        { type: "fillColor", from: [1, 1, 1], to: [1, 0.85, 0] },
        { type: "tracking", from: -8, to: 0 }
      ]
    }
  });
  const props = animators.property(1).property("ADBE Text Animator Properties");
  assert.strictEqual(props.numProperties, 2);
  assert.deepStrictEqual(
    [props.property(1).matchName, props.property(2).matchName],
    ["ADBE Text Fill Color", "ADBE Text Tracking Amount"]
  );
});

// --- selecting what to transcribe -------------------------------------------
//
// "Select the layer with the audio, hit Add Captions" is the workflow the
// plugin is built around. Rendering the whole comp mix regardless meant a
// voiceover under a music bed was transcribed together with the music, which
// costs real accuracy.

test("selecting an audio layer transcribes only that layer", () => {
  const h = load();
  const voice = withAudio(h, "Voiceover");
  withAudio(h, "Music Bed");
  voice.selected = true;

  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.deepStrictEqual(result.layers, ["Voiceover"]);
  assert.strictEqual(result.fromSelection, true);
});

test("selecting nothing transcribes everything audible", () => {
  const h = load();
  withAudio(h, "Voiceover");
  withAudio(h, "Music Bed");

  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.deepStrictEqual(result.layers.sort(), ["Music Bed", "Voiceover"]);
  assert.strictEqual(result.fromSelection, false);
});

test("selecting several audio layers transcribes all of them", () => {
  const h = load();
  const a = withAudio(h, "Dialogue A");
  const b = withAudio(h, "Dialogue B");
  withAudio(h, "Music Bed");
  a.selected = true;
  b.selected = true;

  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.deepStrictEqual(result.layers.sort(), ["Dialogue A", "Dialogue B"]);
});

test("selecting a layer with no audio falls back to the comp mix", () => {
  // Selecting the text layer you are about to caption is a natural thing to
  // do, and it must not silence the render.
  const h = load();
  withAudio(h, "Voiceover");
  const title = h.comp.layers.addText("A Title");
  title.selected = true;

  const result = h.call("capsetRenderAudio", { scope: "composition" });
  assert.deepStrictEqual(result.layers, ["Voiceover"]);
  assert.strictEqual(result.fromSelection, false);
});

test("solo states are exactly as they were afterwards", () => {
  // Soloing is how After Effects expresses "just this layer", but leaving a
  // comp soloed would silently change every render the user makes next.
  const h = load();
  const voice = withAudio(h, "Voiceover");
  const music = withAudio(h, "Music Bed");
  music.solo = true;
  voice.selected = true;

  h.call("capsetRenderAudio", { scope: "composition" });

  assert.strictEqual(music.solo, true, "an existing solo was cleared");
  assert.strictEqual(voice.solo, false, "our temporary solo was left behind");
});

test("solo is restored even when the render fails", () => {
  const h = load({ templates: ["Lossless"] });
  const voice = withAudio(h, "Voiceover");
  voice.selected = true;

  assert.throws(() => h.call("capsetRenderAudio", { scope: "composition" }));
  assert.strictEqual(voice.solo, false);
});

// --- re-applying an animation to existing layers ----------------------------
//
// "Apply to all captions" used to send an empty timings map, so the host fell
// through to a hardcoded copy of the fraction rules and the length chosen in
// the panel was ignored on every layer. The panel now asks for each layer's
// duration and computes timings with the one tested implementation.

test("caption layer times are reported for the whole comp", () => {
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });

  const info = h.call("capsetCaptionLayerTimes", { scope: "all" });

  assert.strictEqual(info.layers.length, CAPTIONS.length);
  info.layers.forEach((entry) => {
    assert.ok(entry.duration > 0, "every layer needs a usable duration");
    assert.ok(entry.name, "timings are keyed by name, so it must be present");
  });
});

test("reported ids match the keys replaceAnimation looks up", () => {
  // These are two separate host calls and the map between them is by id; a
  // mismatch would silently fall back to the defaults for every layer.
  //
  // The id is the layer INDEX, not the name. Caption layers are named after
  // their text, so two captions reading "Yeah." share a name -- and a
  // name-keyed map would hand one of them the other's timings.
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });

  const reported = h.call("capsetCaptionLayerTimes", { scope: "all" })
    .layers.map((l) => l.id).sort();
  const actual = captionLayers(h.comp).map((l) => l.index).sort();

  assert.deepStrictEqual(plain(reported), actual);
});

test("two captions with identical text get their own timings", () => {
  // The failure the index key exists to prevent: same words, different
  // durations, and under a name-keyed map the second layer would be animated
  // with the first one's timing.
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [
      { text: "Yeah.", start: 0, end: 0.4 },
      { text: "Yeah.", start: 2, end: 4 }
    ],
    style: {}, options: {}
  });

  const reported = h.call("capsetCaptionLayerTimes", { scope: "all" }).layers;
  const ids = reported.map((l) => l.id);
  assert.strictEqual(new Set(plain(ids)).size, 2, "the two layers share a key");
  assert.deepStrictEqual(
    plain(reported.map((l) => +l.duration.toFixed(3))).sort(),
    [0.4, 2]
  );
});

test("the comp frame rate comes back so frames can be converted", () => {
  const h = load({ frameRate: 24 });
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const info = h.call("capsetCaptionLayerTimes", { scope: "all" });
  assert.strictEqual(info.frameRate, 24);
});

test("supplied timings are used instead of the built-in fallback", () => {
  const h = load();
  h.call("capsetBuildCaptions", { captions: CAPTIONS, style: {}, options: {} });
  const ids = captionLayers(h.comp).map((l) => l.index);

  const timingsById = {};
  // A length nothing in the fallback rules would ever produce.
  ids.forEach((id) => {
    timingsById[id] = { inStart: 0, inDuration: 0.123, outStart: 0.5, outDuration: 0 };
  });

  h.call("capsetReplaceAnimation", {
    animation: { id: "pop", basedOn: "characters",
      in: { properties: [{ type: "opacity", from: 0, to: 100 }] } },
    scope: "all",
    timingsById: timingsById
  });

  const layer = captionLayers(h.comp)[0];
  const animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
  const prop = animators.property(1)
    .property("ADBE Text Animator Properties").property(1);
  const span = prop.keyTime(prop.numKeys) - prop.keyTime(1);
  assert.ok(
    Math.abs(span - 0.123) < 1e-6,
    "the supplied 0.123s was ignored; the phase ran for " + span.toFixed(3) + "s"
  );
});

// --- every preset in the shipped library actually animates -------------------
//
// The library is data, so a preset can be syntactically perfect and do
// nothing: a typo'd property type is skipped silently, and a from-pose equal
// to the rest pose is a no-op. Both look exactly like a working preset in the
// JSON, and the whole library was in that state until the range selector was
// fixed. This walks the real library through the real host and checks each
// entry produces motion.

const LIBRARY = require("../dormant/animation/animations.json");

const REST = {
  scale: [100, 100, 100], opacity: 100, position: [0, 0, 0], rotation: 0,
  blur: [0, 0, 0], tracking: 0, fillColor: [1, 1, 1], strokeColor: [1, 1, 1],
  strokeWidth: 0
};
const MATCH = {
  scale: "ADBE Text Scale 3D", opacity: "ADBE Text Opacity",
  position: "ADBE Text Position 3D", rotation: "ADBE Text Rotation",
  blur: "ADBE Text Blur", tracking: "ADBE Text Tracking Amount",
  fillColor: "ADBE Text Fill Color", strokeColor: "ADBE Text Stroke Color",
  strokeWidth: "ADBE Text Stroke Width"
};

/**
 * Distance over the dimensions the definition actually declares.
 *
 * Two traps here, both of which produced a test that could not fail:
 *
 * - Position animations move on Y, so comparing only component 0 says nothing.
 * - capsetToValue pads a 2D value to [x, y, 0], but the resting Z of a scale
 *   is 100, so a padded scale always sits 100 away from rest on Z alone. That
 *   swamped the comparison and made every preset look like it animated, even
 *   one whose from-pose was identical to its rest pose.
 *
 * So: compare exactly the components the spec provides, and no more.
 */
function distance(a, b, dims) {
  const A = Array.isArray(a) ? a : [a];
  const B = Array.isArray(b) ? b : [b];
  const n = dims || Math.max(A.length, B.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** How many components a from/to value declares. */
function dimsOf(value) {
  return Array.isArray(value) ? value.length : 1;
}

function applyLibraryAnimation(animation) {
  const h = load();
  h.call("capsetBuildCaptions", {
    captions: [{ text: "one two", start: 0, end: 2,
      timings: { inStart: 0, inDuration: 0.4, outStart: 1.8, outDuration: 0.2 } }],
    style: {}, options: {}, animation
  });
  const layer = captionLayers(h.comp)[0];
  const animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
  let entrance = null;
  for (let i = 1; i <= animators.numProperties; i++) {
    if (/__in$/.test(animators.property(i).name)) entrance = animators.property(i);
  }
  return entrance;
}

LIBRARY.animations.forEach((animation) => {
  if (animation.id === "none") return;      // the deliberate opt-out

  test(`the "${animation.name}" preset actually animates`, () => {
    const entrance = applyLibraryAnimation(animation);
    assert.ok(entrance, animation.id + " built no entrance animator at all");

    const spec = animation["in"].properties[0];
    const matchName = MATCH[spec.type];
    assert.ok(matchName, animation.id + ' animates unknown property "' + spec.type + '"');
    const rest = REST[spec.type];
    const tolerance = spec.type === "fillColor" ? 0.02 : 0.5;
    const dims = dimsOf(spec.from);

    const atStart = ae.effectiveValue(entrance, matchName, 0, 0, 6, rest);
    assert.ok(
      distance(atStart, rest, dims) > tolerance,
      animation.id + " starts at its resting pose (" + JSON.stringify(atStart) +
      "), so the entrance is invisible"
    );

    // NOT asserted by sampling the end of the phase: at that point the
    // selector covers nothing, so the character is at its resting pose
    // whatever the animator says. That check passes for every possible
    // definition and proves nothing. The real requirement is on the data --
    // an entrance has to TARGET the resting pose, or characters resolve
    // towards the wrong value on their way through the sweep.
    const target = spec.to === "$textColor" ? rest : spec.to;
    assert.ok(
      distance(target, rest, dims) < tolerance,
      animation.id + " is an entrance that targets " + JSON.stringify(spec.to) +
      " instead of the resting pose " + JSON.stringify(rest) +
      ", so its characters resolve to the wrong value"
    );
  });
});

test("every property type the library uses is one the host can apply", () => {
  // addProperty is wrapped in try/catch and skips on failure, so a typo'd type
  // is silently dropped and the preset just does less than it claims.
  const used = new Set();
  LIBRARY.animations.forEach((a) => {
    ["in", "out"].forEach((phase) => {
      (a[phase] && a[phase].properties ? a[phase].properties : [])
        .forEach((p) => used.add(p.type));
    });
  });
  const unknown = [...used].filter((t) => !MATCH[t]);
  assert.deepStrictEqual(unknown, [], "property types the host cannot apply");
});

// --- degenerate captions -----------------------------------------------------
//
// Real transcripts are not tidy. Parakeet emits words whose end equals their
// start (particularly at chunk boundaries), and fast speech produces words
// short enough to snap onto a single frame. Both used to become layers with
// zero length, which never appear -- so the caption did not look brief, it
// looked missing.

test("a zero-length caption still gets a visible layer", () => {
  const h = load({ frameRate: 30 });
  h.call("capsetBuildCaptions", {
    captions: [{ text: "blink", start: 1.0, end: 1.0 }], style: {}, options: {}
  });
  const layer = captionLayers(h.comp)[0];
  assert.ok(
    layer.outPoint > layer.inPoint,
    "the layer has no duration, so the caption never appears"
  );
});

test("a caption shorter than a frame is widened to one frame", () => {
  // 20ms at 30fps snaps both ends onto the same frame.
  const h = load({ frameRate: 30 });
  h.call("capsetBuildCaptions", {
    captions: [{ text: "fast", start: 1.00, end: 1.02 }], style: {}, options: {}
  });
  const layer = captionLayers(h.comp)[0];
  const frame = 1 / 30;
  assert.ok(
    layer.outPoint - layer.inPoint >= frame - 1e-9,
    "a fast word collapsed to " + (layer.outPoint - layer.inPoint) + "s"
  );
});

test("a caption whose end precedes its start does not invert the layer", () => {
  const h = load({ frameRate: 30 });
  h.call("capsetBuildCaptions", {
    captions: [{ text: "backwards", start: 2.0, end: 1.0 }], style: {}, options: {}
  });
  const layer = captionLayers(h.comp)[0];
  assert.ok(layer.outPoint > layer.inPoint,
            "outPoint " + layer.outPoint + " is not after inPoint " + layer.inPoint);
});

test("an empty caption creates no layer at all", () => {
  // An empty text layer is invisible but real: it sits in the timeline, counts
  // as a caption, and is one more thing to delete by hand.
  const h = load();
  const result = h.call("capsetBuildCaptions", {
    captions: [
      { text: "real", start: 0, end: 1 },
      { text: "   ", start: 1, end: 2 },
      { text: "", start: 2, end: 3 }
    ],
    style: {}, options: {}
  });
  assert.strictEqual(captionLayers(h.comp).length, 1, "empty captions became layers");
  assert.strictEqual(result.created, 1, "empty captions were counted as created");
});


// --- cleaning up renders ----------------------------------------------------

/**
 * Nothing used to delete these. Every transcription left a full-size
 * uncompressed WAV in the temp folder for good — an hour of 48 kHz stereo is
 * about 690 MB — so a handful of podcasts cost a user gigabytes of disk with
 * no visible connection to a captioning plugin.
 *
 * The deletion is narrow on purpose: the path travels to the backend and back
 * before it is used, and a plugin that removes whatever path it is handed is
 * one bug away from deleting somebody's footage.
 */
function withRender(fsName) {
  const host = load();
  host.fake.writtenFiles.set(fsName, 5_000_000);
  return host;
}

test("a Capset render in the temp folder is deleted", () => {
  const host = withRender("/tmp/capset_1717171717.wav");
  const result = host.call("capsetDiscardRender", { path: "/tmp/capset_1717171717.wav" });
  assert.strictEqual(result.removed, true);
  assert.ok(!host.fake.writtenFiles.has("/tmp/capset_1717171717.wav"));
});

test("a file outside the temp folder is left alone", () => {
  // The name deliberately matches ours exactly, so ONLY the folder check can
  // save this file. A differently-named file would pass this test even with
  // the folder check deleted, which is no test at all.
  const victim = "/Users/joe/Footage/capset_1717171717.wav";
  const host = withRender(victim);
  assert.strictEqual(host.call("capsetDiscardRender", { path: victim }).removed, false);
  assert.ok(
    host.fake.writtenFiles.has(victim),
    "deleted a file outside the temp folder"
  );
});

test("a file in the temp folder that is not ours is left alone", () => {
  const host = withRender("/tmp/something-else.wav");
  const result = host.call("capsetDiscardRender", { path: "/tmp/something-else.wav" });
  assert.strictEqual(result.removed, false);
  assert.ok(host.fake.writtenFiles.has("/tmp/something-else.wav"));
});

test("a name that only starts like ours is not enough", () => {
  // "capset_notes.wav" is not a render; ours are capset_<timestamp>.<ext>.
  const host = withRender("/tmp/capset_notes.wav");
  assert.strictEqual(
    host.call("capsetDiscardRender", { path: "/tmp/capset_notes.wav" }).removed,
    false
  );
  assert.ok(host.fake.writtenFiles.has("/tmp/capset_notes.wav"));
});

test("a missing file is not an error", () => {
  const host = load();
  assert.strictEqual(
    host.call("capsetDiscardRender", { path: "/tmp/capset_1.wav" }).removed,
    false
  );
});

test("no path at all is not an error", () => {
  // Cleanup must never be the thing that fails a run that already succeeded.
  const host = load();
  assert.strictEqual(host.call("capsetDiscardRender", {}).removed, false);
});
