/**
 * The Proofread tab's host functions, executed against the fake host.
 *
 * What an edit is gets decided in js/lib/proofread.js (tests/proofread.test.js);
 * these cover finding the layer again, refusing a stale edit, and applying one
 * without disturbing anything else about the caption.
 */
const test = require("node:test");
const assert = require("node:assert");
const { load } = require("./jsx-host.js");
const pr = require("../js/lib/proofread.js");

const CAPTIONS = [
  { text: "first caption", start: 0.0, end: 1.2 },
  { text: "second caption", start: 1.2, end: 2.5 },
  { text: "third caption", start: 2.5, end: 4.0 }
];

const CAPSET_TAG = "Capset caption";
const captionLayers = (comp) =>
  comp.layers._layers.filter((l) => l.comment === CAPSET_TAG);
const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || a + " != " + b);

/** Build captions, and return the host plus the list as the panel reads it. */
function built(options = {}, buildOptions = {}) {
  const h = load(options);
  h.call("capsetBuildCaptions", {
    captions: options.captions || CAPTIONS, style: {}, options: buildOptions
  });
  return Object.assign(h, { list: () => plain(h.call("capsetProofreadList")) });
}

function layerFor(h, row) {
  return captionLayers(h.comp).concat(
    h.comp.layers._layers.filter((l) => l.source)
      .flatMap((l) => l.source.layers._layers)
  ).find((l) => l.id === row.ref.layerId);
}

/** Record the undo groups opened, and check each one is closed. */
function spyUndo(h) {
  const opened = [];
  const begin = h.fake.app.beginUndoGroup;
  h.fake.app.beginUndoGroup = (name) => { opened.push(name); begin(name); };
  return opened;
}

// --- listing -----------------------------------------------------------------

test("the list is every caption, in time order, with its text and times", () => {
  const h = built();
  const data = h.list();
  assert.strictEqual(data.comp.name, h.comp.name);
  assert.strictEqual(data.comp.frameRate, 30);
  assert.strictEqual(data.comp.dropFrame, false);
  assert.strictEqual(data.comp.displayStartTime, 0);
  assert.deepStrictEqual(data.captions.map((c) => c.text),
                         ["first caption", "second caption", "third caption"]);
  assert.deepStrictEqual(data.captions.map((c) => +c.start.toFixed(3)), [0, 1.2, 2.5]);
  data.captions.forEach((c) => {
    assert.strictEqual(c.ref.compId, h.comp.id);
    assert.strictEqual(typeof c.ref.layerId, "number");
    assert.strictEqual(typeof c.ref.index, "number");
  });
});

test("line breaks reach the list as \\n", () => {
  const h = built({ captions: [{ lines: ["top", "bottom"], start: 0, end: 1 }] });
  assert.strictEqual(h.list().captions[0].text, "top\nbottom");
});

test("a comp with no captions lists nothing rather than failing", () => {
  const h = load();
  assert.deepStrictEqual(plain(h.call("capsetProofreadList")).captions, []);
});

test("the list leaves out the controller and other text", () => {
  const h = built({}, { parentToController: true });
  h.comp.layers.addText("A title that is not a caption");
  assert.strictEqual(h.list().captions.length, 3);
});

// --- retyping ----------------------------------------------------------------

test("retyping a caption changes its text and keeps its look", () => {
  const h = built();
  const row = h.list().captions[1];
  const layer = layerFor(h, row);
  const before = layer.property("Source Text").value;
  before.fontSize = 55;
  before.font = "Futura";
  layer.property("Source Text").setValue(before);

  const result = pr.retext(row, "second\ncaption, fixed");
  h.call("capsetProofreadApply", { label: "text", edits: [result.edit] });

  const doc = layer.property("Source Text").value;
  assert.strictEqual(doc.text, "second\rcaption, fixed", "line breaks go in as \\r");
  assert.strictEqual(doc.fontSize, 55);
  assert.strictEqual(doc.font, "Futura");
  close(layer.inPoint, 1.2);
  close(layer.outPoint, 2.5);
});

test("the layer is renamed with its text, unless someone renamed it", () => {
  const h = built();
  const [first, second] = h.list().captions;
  layerFor(h, second).name = "Keep this name";

  h.call("capsetProofreadApply", {
    label: "text",
    edits: [pr.retext(first, "First, fixed").edit, pr.retext(second, "Second, fixed").edit]
  });
  assert.strictEqual(layerFor(h, first).name, "First, fixed");
  assert.strictEqual(layerFor(h, second).name, "Keep this name");
});

test("retyping under the controller does not bake its look into the layer", () => {
  // With Parent to Controller, Source Text carries an expression and .value is
  // what it produced. Read-modify-write through .value would copy the
  // controller's current size onto the layer itself.
  const h = built({}, { parentToController: true });
  const row = h.list().captions[0];
  const prop = layerFor(h, row).property("Source Text");
  assert.ok(prop.expression, "the controller rig did not add a Source Text expression");
  const own = prop.valueAtTime(0, true).fontSize;
  const styled = prop.value;
  styled.fontSize = own + 100;
  prop._expressionResult = styled;

  h.call("capsetProofreadApply", { label: "text", edits: [pr.retext(row, "Fixed").edit] });
  const after = prop.valueAtTime(0, true);
  assert.strictEqual(after.text, "Fixed");
  assert.strictEqual(after.fontSize, own, "the expression's output was written back");
  assert.ok(prop.expression, "the controller expression was lost");
});

test("an empty caption is refused", () => {
  const h = built();
  const row = h.list().captions[0];
  const edit = Object.assign(pr.retext(row, "x").edit, { text: "  " });
  assert.throws(() => h.call("capsetProofreadApply", { edits: [edit] }), /cannot be empty/);
});

test("a caption with keyframed text is left for the timeline", () => {
  const h = built();
  const row = h.list().captions[0];
  const prop = layerFor(h, row).property("Source Text");
  prop.setValueAtTime(0.5, prop.value);
  assert.throws(
    () => h.call("capsetProofreadApply", { edits: [pr.retext(row, "New").edit] }),
    /Source Text keyframes/
  );
});

// --- retiming ----------------------------------------------------------------

test("retiming trims the layer to the frame", () => {
  const h = built();
  const c = h.list().comp;
  const row = h.list().captions[1];
  h.call("capsetProofreadApply", {
    label: "time", edits: [pr.retime(row, "end", 2.81, c).edit]
  });
  const layer = layerFor(h, row);
  close(layer.inPoint, 1.2);
  close(layer.outPoint, 2.8);
});

test("a caption can be moved wholly past where it used to end", () => {
  // After Effects refuses an in point after the out point, so the order the
  // two ends are set in has to follow the direction of the move.
  const h = built();
  const row = h.list().captions[0];
  const layer = layerFor(h, row);
  h.call("capsetProofreadApply", {
    edits: [{ ref: row.ref, expect: pr.expectOf(row), start: 5, end: 6 }]
  });
  close(layer.inPoint, 5);
  close(layer.outPoint, 6);

  const moved = h.list().captions.find((c) => c.ref.layerId === row.ref.layerId);
  h.call("capsetProofreadApply", {
    edits: [{ ref: moved.ref, expect: pr.expectOf(moved), start: 0.5, end: 0.9 }]
  });
  close(layer.inPoint, 0.5);
  close(layer.outPoint, 0.9);
});

test("a caption cannot be made to end before it starts", () => {
  const h = built();
  const row = h.list().captions[0];
  assert.throws(() => h.call("capsetProofreadApply", {
    edits: [{ ref: row.ref, expect: pr.expectOf(row), start: 1, end: 1 }]
  }), /end before it starts/);
});

// --- refusing stale edits ----------------------------------------------------

test("a caption changed in After Effects since the list was read is left alone", () => {
  const h = built();
  const row = h.list().captions[0];
  const layer = layerFor(h, row);
  const doc = layer.property("Source Text").value;
  doc.text = "Typed in the timeline";
  layer.property("Source Text").setValue(doc);

  assert.throws(
    () => h.call("capsetProofreadApply", { edits: [pr.retext(row, "From the panel").edit] }),
    /changed since the list was read/
  );
  assert.strictEqual(layer.property("Source Text").value.text, "Typed in the timeline");
});

test("a caption retimed in After Effects is left alone too", () => {
  const h = built();
  const row = h.list().captions[0];
  layerFor(h, row).outPoint = 1.5;
  assert.throws(
    () => h.call("capsetProofreadApply", { edits: [pr.retext(row, "x").edit] }),
    /changed since the list was read/
  );
});

test("a deleted caption is refused, not written somewhere else", () => {
  const h = built();
  const row = h.list().captions[0];
  layerFor(h, row).remove();
  assert.throws(
    () => h.call("capsetProofreadApply", { edits: [pr.retext(row, "x").edit] }),
    /changed since the list was read/
  );
});

test("a batch with one stale caption changes nothing at all", () => {
  const h = built();
  const rows = h.list().captions;
  layerFor(h, rows[2]).outPoint = 3.5;
  const out = pr.replaceAll(rows, "caption", "line", false);
  assert.strictEqual(out.edits.length, 3);
  assert.throws(() => h.call("capsetProofreadApply", { label: "replace", edits: out.edits }),
                /changed since/);
  assert.deepStrictEqual(h.list().captions.map((c) => c.text),
                         ["first caption", "second caption", "third caption"]);
});

test("the layer is found by id after the timeline is reordered", () => {
  const h = built();
  const row = h.list().captions[0];
  const layer = layerFor(h, row);
  h.comp.layers.addText("something new on top");
  layer.moveToBeginning();
  h.call("capsetProofreadApply", { edits: [pr.retext(row, "Still found").edit] });
  assert.strictEqual(layer.property("Source Text").value.text, "Still found");
});

test("without layer ids, the index is used and still checked", () => {
  // Layer.id arrived in After Effects 22. On older versions the ref is an
  // index, and the expect check is what keeps it from hitting another layer.
  const h = built();
  h.comp.layers._layers.forEach((l) => { l.id = undefined; });
  const rows = h.list().captions;
  assert.strictEqual(rows[0].ref.layerId, null);
  h.call("capsetProofreadApply", { edits: [pr.retext(rows[0], "By index").edit] });
  assert.strictEqual(h.list().captions[0].text, "By index");

  // A new layer on top moves every index down by one.
  h.comp.layers.addText("new");
  assert.throws(
    () => h.call("capsetProofreadApply", { edits: [pr.retext(rows[1], "x").edit] }),
    /changed since/
  );
});

// --- undo --------------------------------------------------------------------

test("each panel action is one undo step, named for what it did", () => {
  const h = built();
  const opened = spyUndo(h);
  const rows = h.list().captions;
  h.call("capsetProofreadApply", {
    label: "replace", edits: pr.replaceAll(rows, "caption", "line", false).edits
  });
  h.call("capsetProofreadApply", { label: "whatever the panel says",
                                   edits: [pr.retext(h.list().captions[0], "x").edit] });
  assert.deepStrictEqual(opened, ["Capset: replace text", "Capset: edit captions"]);
  assert.strictEqual(h.fake.app._undoStack.length, 0, "an undo group was left open");
});

test("a refused edit opens no undo step", () => {
  const h = built();
  const opened = spyUndo(h);
  const row = h.list().captions[0];
  layerFor(h, row).remove();
  assert.throws(() => h.call("capsetProofreadApply", { edits: [pr.retext(row, "x").edit] }));
  assert.deepStrictEqual(opened, []);
});

// --- shift -------------------------------------------------------------------

test("shifting moves each layer, keyframes and all", () => {
  const h = built();
  const data = h.list();
  const out = pr.shift(data.captions, 1, 6, data.comp);
  h.call("capsetProofreadApply", { label: "shift", edits: out.edits });
  const after = h.list().captions;
  assert.deepStrictEqual(after.map((c) => +c.start.toFixed(3)), [0, 1.4, 2.7]);
  assert.deepStrictEqual(after.map((c) => +c.end.toFixed(3)), [1.2, 2.7, 4.2]);
  close(layerFor(h, after[2]).startTime, 0.2, "the layer was trimmed, not moved");
});

test("a shift past the start of the comp is refused by the host as well", () => {
  const h = built();
  const row = h.list().captions[0];
  assert.throws(() => h.call("capsetProofreadApply", {
    edits: [{ ref: row.ref, expect: pr.expectOf(row), shiftBy: -1 }]
  }), /before the composition/);
});

// --- precomposed captions ----------------------------------------------------

test("precomposed captions are listed on the outer timeline and edited in place", () => {
  const h = built({}, { precompose: true });
  const precomp = h.comp.layers._layers.find((l) => l.source);
  precomp.startTime = 10;

  const data = h.list();
  assert.deepStrictEqual(data.captions.map((c) => +c.start.toFixed(3)), [10, 11.2, 12.5]);
  const row = data.captions[1];
  assert.strictEqual(row.ref.compId, precomp.source.id);

  h.call("capsetProofreadApply", { edits: [pr.retime(row, "end", 13, data.comp).edit] });
  const inner = layerFor(h, row);
  close(inner.outPoint, 3, "the outer time was not converted to the precomp's");
  close(h.list().captions[1].end, 13);
});

test("a precomp moved since the list was read is caught", () => {
  const h = built({}, { precompose: true });
  const row = h.list().captions[0];
  h.comp.layers._layers.find((l) => l.source).startTime = 4;
  assert.throws(
    () => h.call("capsetProofreadApply", { edits: [pr.retext(row, "x").edit] }),
    /changed since/
  );
});

// --- split and merge ---------------------------------------------------------

test("split turns one caption into two that share its look", () => {
  const h = built({}, { parentToController: true });
  const data = h.list();
  const row = data.captions[1];
  const layer = layerFor(h, row);
  layer.property("Effects").addProperty("ADBE Drop Shadow");
  const parts = pr.splitAt(row, "second".length, data.comp);

  const opened = spyUndo(h);
  h.call("capsetProofreadSplit", {
    ref: row.ref, expect: pr.expectOf(row), first: parts.first, second: parts.second
  });
  assert.deepStrictEqual(opened, ["Capset: split caption"]);

  const after = h.list().captions;
  assert.deepStrictEqual(after.map((c) => c.text),
                         ["first caption", "second", "caption", "third caption"]);
  close(after[1].end, after[2].start);
  close(after[1].start, 1.2);
  close(after[2].end, 2.5);

  const copy = layerFor(h, after[2]);
  assert.notStrictEqual(copy, layer);
  assert.strictEqual(copy.comment, CAPSET_TAG);
  assert.strictEqual(copy.parent, layer.parent);
  assert.ok(copy.parent, "the copy lost the controller");
  assert.strictEqual(copy.name, "caption");
  assert.strictEqual(layer.name, "second");
  assert.strictEqual(copy.property("Effects").numProperties,
                     layer.property("Effects").numProperties);
  assert.strictEqual(copy.property("Source Text").expression,
                     layer.property("Source Text").expression);
});

test("a split of a stale caption changes nothing", () => {
  const h = built();
  const data = h.list();
  const row = data.captions[0];
  layerFor(h, row).outPoint = 1;
  const parts = pr.splitAt(row, 5, data.comp);
  assert.throws(() => h.call("capsetProofreadSplit", {
    ref: row.ref, expect: pr.expectOf(row), first: parts.first, second: parts.second
  }), /changed since/);
  assert.strictEqual(captionLayers(h.comp).length, 3);
});

test("merge folds the next caption into this one and removes its layer", () => {
  const h = built();
  const [a, b] = h.list().captions;
  const merged = pr.merge(a, b);
  const opened = spyUndo(h);
  h.call("capsetProofreadMerge", Object.assign({
    ref: a.ref, expect: pr.expectOf(a), next: { ref: b.ref, expect: pr.expectOf(b) }
  }, merged));
  assert.deepStrictEqual(opened, ["Capset: merge captions"]);

  const after = h.list().captions;
  assert.deepStrictEqual(after.map((c) => c.text), ["first caption second caption", "third caption"]);
  close(after[0].start, 0);
  close(after[0].end, 2.5);
  assert.strictEqual(captionLayers(h.comp).length, 2);
});

test("merge refuses captions that no longer match", () => {
  const h = built();
  const [a, b] = h.list().captions;
  layerFor(h, b).remove();
  assert.throws(() => h.call("capsetProofreadMerge", Object.assign({
    ref: a.ref, expect: pr.expectOf(a), next: { ref: b.ref, expect: pr.expectOf(b) }
  }, pr.merge(a, b))), /changed since/);
  assert.strictEqual(h.list().captions[0].text, "first caption");
});

// --- go to -------------------------------------------------------------------

test("go to moves the playhead and selects the caption", () => {
  const h = built();
  const row = h.list().captions[2];
  captionLayers(h.comp)[0].selected = true;
  const result = h.call("capsetProofreadReveal", { ref: row.ref, time: row.start });
  assert.strictEqual(result.selected, true);
  close(h.comp.time, 2.5);
  const selected = h.comp.selectedLayers;
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0], layerFor(h, row));
});

test("go to on a precomposed caption selects the precomp", () => {
  const h = built({}, { precompose: true });
  const row = h.list().captions[1];
  h.call("capsetProofreadReveal", { ref: row.ref, time: row.start });
  const selected = h.comp.selectedLayers;
  assert.strictEqual(selected.length, 1);
  assert.ok(selected[0].source, "the precomp layer was not the one selected");
});

// --- the export is unaffected ------------------------------------------------

test("the SRT export still reads the same captions", () => {
  const h = built();
  const exported = plain(h.call("capsetCaptionsForExport").captions);
  assert.deepStrictEqual(exported.map((c) => c.text).sort(),
                         ["first caption", "second caption", "third caption"]);
});

// --- cost ----------------------------------------------------------------------

test("a batch edit reads each layer a bounded number of times", () => {
  // Every ExtendScript call into the After Effects object model is slow. A
  // batch that searched the comp afresh for every caption made Shift all on
  // 800 word captions read layers 321,200 times -- long enough to look like
  // After Effects had hung. Finding captions has to stay linear.
  const n = 400;
  const captions = [];
  for (let i = 0; i < n; i++) captions.push({ text: "w" + i, start: i * 0.5, end: i * 0.5 + 0.4 });
  const h = built({ duration: 1000, captions });
  const data = h.list();
  assert.strictEqual(data.captions.length, n);

  let reads = 0;
  const layer = h.comp.layer.bind(h.comp);
  h.comp.layer = (i) => { reads++; return layer(i); };
  const item = h.fake.project.item;
  h.fake.project.item = (i) => { reads++; return item(i); };

  h.call("capsetProofreadApply", {
    label: "shift", edits: pr.shift(data.captions, 0, 3, data.comp).edits
  });
  assert.ok(reads <= 6 * n, reads + " object-model reads for " + n + " captions");
  close(h.list().captions[n - 1].start, (n - 1) * 0.5 + 0.1);
});
