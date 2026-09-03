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
