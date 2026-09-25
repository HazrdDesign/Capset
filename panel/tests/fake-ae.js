/**
 * A fake After Effects object model, enough to execute panel/jsx/capset.jsx.
 *
 * WHY THIS EXISTS
 *
 * The host script had never been run — not once, in any environment. Every
 * claim about it was from reading it. This does not replace testing in After
 * Effects, and it cannot: it does not know which match names a real host
 * accepts, what precompose does to a layer's properties, or how the Character
 * panel behaves. What it does catch is the large class of bugs that need no
 * host to be wrong — a function that renames the wrong object, a rebuild that
 * fails to find what it created, a payload field nothing ever reads.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not silently accept everything. A fake that returns a plausible
 * object for every call proves only that the code runs, so unknown property
 * names throw here exactly as an unknown match name would in AE. Where a real
 * host would reject something this fake cannot know about, the test says so
 * rather than pretending.
 */
"use strict";

// --- constants the host script reads ---------------------------------------

const ParagraphJustification = {
  LEFT_JUSTIFY: 7413,
  CENTER_JUSTIFY: 7415,
  RIGHT_JUSTIFY: 7414
};

class KeyframeEase {
  constructor(speed, influence) {
    this.speed = speed;
    this.influence = influence;
  }
}

// --- properties -------------------------------------------------------------

let nextId = 1;

class Property {
  constructor(name, matchName, value) {
    this.id = nextId++;
    this.name = name;
    this.matchName = matchName;
    this._value = value;
    this.keys = [];            // {time, value, easeIn, easeOut}
    this.expression = "";
    this.selected = false;
    this.parentGroup = null;
  }
  get value() { return this._value; }
  /**
   * The value with or without the expression applied. The fake does not
   * evaluate expressions, so the two differ only where a test has said what
   * an expression produces (Source Text's `_expressionResult`) -- which is
   * enough to tell code that reads the layer's own value from code that
   * reads the expression's output and writes it back.
   */
  valueAtTime(time, preExpression) {
    if (!preExpression) return this.value;
    const v = this._value;
    return v instanceof TextDocument ? Object.assign(new TextDocument(""), v) : v;
  }
  // After Effects enables an expression when one is set; a test can switch it
  // off again to model a disabled (or errored) expression.
  get expressionEnabled() { return this._expressionEnabled !== false && this.expression !== ""; }
  set expressionEnabled(on) { this._expressionEnabled = !!on; }
  setValue(v) { this._value = v; this.keys = []; }
  setValueAtTime(time, v) {
    this.keys.push({ time, value: v, easeIn: null, easeOut: null });
    this.keys.sort((a, b) => a.time - b.time);
    this._value = v;
  }
  get numKeys() { return this.keys.length; }
  keyTime(i) { return this.keys[i - 1].time; }
  keyValue(i) { return this.keys[i - 1].value; }
  setTemporalEaseAtKey(index, inEase, outEase) {
    const key = this.keys[index - 1];
    if (!key) throw new Error("no key at index " + index);
    key.easeIn = inEase;
    key.easeOut = outEase;
  }
  remove() {
    if (this.parentGroup) this.parentGroup._remove(this);
  }
  property() {
    throw new Error("cannot descend into the leaf property " + this.name);
  }
}

/**
 * A group of properties addressable by name, match name, or 1-based index.
 *
 * `addable` lists the match names addProperty accepts. Anything else throws,
 * mirroring a host rejecting an unknown match name — code that guesses a name
 * must handle the failure, and the guards in capset.jsx say they do.
 */
class PropertyGroup {
  constructor(name, matchName, options = {}) {
    this.id = nextId++;
    this.name = name;
    this.matchName = matchName;
    this._children = [];
    this._addable = options.addable || null;   // null = accept anything
    this._makeChild = options.makeChild || null;
    this.parentGroup = null;
    this.selected = false;
  }
  get numProperties() { return this._children.length; }
  _add(child) {
    child.parentGroup = this;
    this._children.push(child);
    return child;
  }
  _remove(child) {
    const i = this._children.indexOf(child);
    if (i !== -1) this._children.splice(i, 1);
  }
  property(key) {
    if (typeof key === "number") {
      const found = this._children[key - 1];
      if (!found) throw new Error("no property at index " + key);
      return found;
    }
    const found = this._children.find((c) => c.name === key || c.matchName === key);
    if (!found) throw new Error("no property named " + key + " under " + this.name);
    return found;
  }
  addProperty(matchName) {
    if (this._addable && this._addable.indexOf(matchName) === -1) {
      throw new Error("this host does not accept " + matchName);
    }
    if (this._makeChild) return this._add(this._makeChild(matchName));
    return this._add(new Property(matchName, matchName, 0));
  }
  remove() { if (this.parentGroup) this.parentGroup._remove(this); }
}

// --- text ---------------------------------------------------------------

/** Mirrors the parts of TextDocument the host script touches. */
/**
 * What addText() would inherit from AE's Character panel, on a fresh
 * reset(). Overridable via setCharacterPanelDefaults() so a test can pretend
 * the user's Character panel was already set to something -- e.g. 110pt
 * yellow with a stroke -- BEFORE calling capsetBuildCaptions, which is
 * exactly the situation a controller must not silently override.
 */
let characterPanelDefaults = null;

function setCharacterPanelDefaults(defaults) {
  characterPanelDefaults = defaults || null;
}

class TextDocument {
  constructor(text) {
    const d = characterPanelDefaults || {};
    this.text = text;
    this.font = d.font !== undefined ? d.font : "Arial";
    this.fontSize = d.fontSize !== undefined ? d.fontSize : 72;
    this.tracking = d.tracking !== undefined ? d.tracking : 0;
    this.leading = d.leading !== undefined ? d.leading : 86.4;
    this.justification = d.justification !== undefined
      ? d.justification : ParagraphJustification.LEFT_JUSTIFY;
    this.applyFill = d.applyFill !== undefined ? d.applyFill : true;
    this.applyStroke = d.applyStroke !== undefined ? d.applyStroke : false;
    this.strokeWidth = d.strokeWidth !== undefined ? d.strokeWidth : 0;
    this.strokeOverFill = d.strokeOverFill !== undefined ? d.strokeOverFill : false;
    this.fillColor = d.fillColor !== undefined ? d.fillColor : [1, 1, 1];
    this.strokeColor = d.strokeColor !== undefined ? d.strokeColor : [0, 0, 0];
    // Real, scriptable TextDocument properties (allCaps is read-only via the
    // classic API as of the AE version this targets; autoLeading always is)
    // -- both read by capsetReadStyleFromDoc to seed the controller rig
    // without changing how a caption already looks.
    this.allCaps = d.allCaps !== undefined ? d.allCaps : false;
    this.autoLeading = d.autoLeading !== undefined ? d.autoLeading : true;
  }
}

function makeTextAnimators() {
  return new PropertyGroup("Animators", "ADBE Text Animators", {
    addable: ["ADBE Text Animator"],
    makeChild: () => {
      const animator = new PropertyGroup("Animator 1", "ADBE Text Animator");
      animator._add(new PropertyGroup(
        "Properties", "ADBE Text Animator Properties",
        {
          addable: [
            "ADBE Text Position 3D", "ADBE Text Scale 3D",
            "ADBE Text Rotation", "ADBE Text Opacity", "ADBE Text Blur",
            "ADBE Text Fill Color", "ADBE Text Stroke Color",
            "ADBE Text Stroke Width", "ADBE Text Tracking Amount"
          ]
        }
      ));
      animator._add(new PropertyGroup("Selectors", "ADBE Text Selectors", {
        addable: ["ADBE Text Selector"],
        makeChild: () => {
          const selector = new PropertyGroup("Range Selector 1", "ADBE Text Selector");
          selector._add(new Property("Units", "ADBE Text Range Type2", 1));
          // Start/End default to the whole text, as they do in After Effects.
          // They are what decide how much of the animator reaches each
          // character, so a fake without them cannot represent the difference
          // between an animation that runs and one that cancels itself out.
          selector._add(new Property("Start", "ADBE Text Percent Start", 0));
          selector._add(new Property("End", "ADBE Text Percent End", 100));
          selector._add(new Property("Offset", "ADBE Text Percent Offset", 0));
          return selector;
        }
      }));
      return animator;
    }
  });
}

/** A deep copy of a property tree, for Layer.duplicate. */
function cloneTree(node) {
  if (node instanceof PropertyGroup) {
    const group = new PropertyGroup(node.name, node.matchName, {
      addable: node._addable, makeChild: node._makeChild
    });
    node._children.forEach((child) => group._add(cloneTree(child)));
    return group;
  }
  const copyValue = (v) => v instanceof TextDocument
    ? Object.assign(new TextDocument(""), v)
    : Array.isArray(v) ? v.slice() : v;
  const prop = new Property(node.name, node.matchName, copyValue(node._value));
  prop.keys = node.keys.map((k) => Object.assign({}, k, { value: copyValue(k.value) }));
  prop.expression = node.expression;
  prop._expressionEnabled = node._expressionEnabled;
  prop._expressionResult = node._expressionResult;
  // Source Text's copy-on-read getter lives on the instance.
  const getter = Object.getOwnPropertyDescriptor(node, "value");
  if (getter) Object.defineProperty(prop, "value", getter);
  return prop;
}

// --- layers -----------------------------------------------------------------

class Layer {
  constructor(comp, name) {
    this.id = nextId++;
    this.containingComp = comp;
    this.name = name;
    this._inPoint = 0;
    this._outPoint = comp ? comp.duration : 0;
    // Real layers carry a comment, and Capset uses it to mark its own
    // captions -- so a fake without one would make every capsetIsCapsetLayer
    // test pass through the legacy name check instead of the live path.
    this.comment = "";
    // Where the layer's source time zero sits in this comp. Only a precomp
    // layer normally moves it, and it is what shifts precomposed captions
    // into the timeline the user is looking at.
    this._startTime = 0;
    this.enabled = true;
    this.solo = false;
    this.selected = false;
    this.parent = null;
    this.hasAudio = false;
    this.source = null;
    this._groups = {};
    const transform = new PropertyGroup("Transform", "ADBE Transform Group");
    transform._add(new Property("Position", "ADBE Position", [0, 0]));
    transform._add(new Property("Scale", "ADBE Scale", [100, 100]));
    transform._add(new Property("Opacity", "ADBE Opacity", 100));
    this._groups["Transform"] = transform;
    this._groups["ADBE Transform Group"] = transform;
    const effects = new PropertyGroup("Effects", "ADBE Effect Parade", {
      makeChild: (matchName) => {
        const effect = new PropertyGroup(matchName, matchName);
        if (matchName === "ADBE Slider Control") {
          effect._add(new Property("Slider", "ADBE Slider Control-0001", 0));
        } else if (matchName === "ADBE Color Control") {
          effect._add(new Property("Color", "ADBE Color Control-0001", [1, 1, 1]));
        } else if (matchName === "ADBE Checkbox Control") {
          effect._add(new Property("Checkbox", "ADBE Checkbox Control-0001", 0));
        } else if (matchName === "ADBE Drop Shadow") {
          // Standard, long-documented property names for the built-in Drop
          // Shadow effect -- see the note above capsetLinkShadowToController
          // in capset.jsx for how confidently these are held.
          effect._add(new Property("Shadow Color", "ADBE Drop Shadow-0001", [0, 0, 0, 1]));
          effect._add(new Property("Opacity", "ADBE Drop Shadow-0002", 50));
          effect._add(new Property("Direction", "ADBE Drop Shadow-0003", 135));
          effect._add(new Property("Distance", "ADBE Drop Shadow-0004", 5));
          effect._add(new Property("Softness", "ADBE Drop Shadow-0005", 10));
          effect._add(new Property("Shadow Only", "ADBE Drop Shadow-0006", 0));
        }
        return effect;
      }
    });
    this._groups["Effects"] = effects;
    this._groups["ADBE Effect Parade"] = effects;
  }
  property(key) {
    const found = this._groups[key];
    if (!found) throw new Error("no property named " + key + " on layer " + this.name);
    return found;
  }
  // After Effects refuses an in point at or after the out point, and an out
  // point at or before the in point, so the order two trims are made in
  // matters. The fake refuses too, or code that gets the order wrong would
  // pass here and fail in the host.
  get inPoint() { return this._inPoint; }
  set inPoint(t) {
    if (!(t < this._outPoint)) {
      throw new Error("inPoint " + t + " is not before outPoint " + this._outPoint);
    }
    this._inPoint = t;
  }
  get outPoint() { return this._outPoint; }
  set outPoint(t) {
    if (!(t > this._inPoint)) {
      throw new Error("outPoint " + t + " is not after inPoint " + this._inPoint);
    }
    this._outPoint = t;
  }
  // Moving a layer's start time moves the whole layer: in and out points go
  // with it, as they do in After Effects.
  get startTime() { return this._startTime; }
  set startTime(t) {
    const by = t - this._startTime;
    this._startTime = t;
    this._inPoint += by;
    this._outPoint += by;
  }
  /**
   * A copy of the layer, placed directly above it, as After Effects does.
   *
   * Properties, effects, expressions, the parent and the comment all come
   * along. What After Effects NAMES the copy is not something this project
   * has verified, so the fake deliberately names it differently from the
   * original: code that needs a particular name has to set it.
   */
  duplicate() {
    const copy = this instanceof TextLayer
      ? new TextLayer(this.containingComp, "")
      : new this.constructor(this.containingComp, this.name);
    const cloned = new Map();
    const tree = (node) => {
      if (!cloned.has(node)) cloned.set(node, cloneTree(node));
      return cloned.get(node);
    };
    copy._groups = {};
    Object.keys(this._groups).forEach((key) => { copy._groups[key] = tree(this._groups[key]); });
    copy.name = this.name + " 2";
    copy.comment = this.comment;
    copy.enabled = this.enabled;
    copy.parent = this.parent;
    copy.hasAudio = this.hasAudio;
    copy.source = this.source;
    copy._startTime = this._startTime;
    copy._inPoint = this._inPoint;
    copy._outPoint = this._outPoint;
    const layers = this.containingComp.layers._layers;
    layers.splice(layers.indexOf(this), 0, copy);
    return copy;
  }
  get index() {
    const i = this.containingComp.layers._layers.indexOf(this);
    if (i === -1) throw new Error(this.name + " is no longer in the comp");
    return i + 1;
  }
  remove() { this.containingComp.layers._remove(this); }
  moveToBeginning() {
    const layers = this.containingComp.layers._layers;
    layers.splice(layers.indexOf(this), 1);
    layers.unshift(this);
  }
}

class AVLayer extends Layer {}

class TextLayer extends Layer {
  constructor(comp, text) {
    super(comp, text);
    const props = new PropertyGroup("Text", "ADBE Text Properties");
    const sourceText = new Property("Source Text", "ADBE Text Document",
                                    new TextDocument(text));
    // Real AE hands back a COPY; mutating it does nothing until setValue.
    // With an expression on, what comes back is the expression's output; a
    // test models that by setting `_expressionResult`.
    Object.defineProperty(sourceText, "value", {
      get() {
        const v = this.expressionEnabled && this._expressionResult
          ? this._expressionResult : this._value;
        return Object.assign(new TextDocument(""), v);
      },
      configurable: true
    });
    props._add(sourceText);
    props._add(makeTextAnimators());
    this._groups["ADBE Text Properties"] = props;
    this._groups["Source Text"] = sourceText;
    this._groups["Text"] = props;
  }
}

class ShapeLayer extends Layer {}

class LayerCollection {
  constructor(comp) { this.comp = comp; this._layers = []; }
  get length() { return this._layers.length; }
  _remove(layer) {
    const i = this._layers.indexOf(layer);
    if (i !== -1) this._layers.splice(i, 1);
  }
  addText(text) {
    const layer = new TextLayer(this.comp, text);
    this._layers.unshift(layer);          // new layers go on top, as in AE
    return layer;
  }
  addNull() {
    const layer = new AVLayer(this.comp, "Null 1");
    this._layers.unshift(layer);
    return layer;
  }
  /**
   * Returns the new COMPOSITION, not the layer — the distinction that makes
   * `precompose(...).name = x` rename the project item and leave the layer in
   * the timeline called something else.
   */
  precompose(indices, name) {
    const moved = indices.map((i) => this._layers[i - 1]);
    const inner = new CompItem(name, this.comp.width, this.comp.height,
                               this.comp.duration, this.comp.frameRate);
    moved.forEach((layer) => {
      this._remove(layer);
      layer.containingComp = inner;
      inner.layers._layers.push(layer);
    });
    const placeholder = new AVLayer(this.comp, name);
    placeholder.source = inner;
    this._layers.unshift(placeholder);
    inner._placeholder = placeholder;
    project.items.push(inner);
    return inner;
  }
}

// --- render queue -----------------------------------------------------------

/** Templates a stock After Effects install offers for an audio-only render. */
const DEFAULT_TEMPLATES = [
  "Lossless", "High Quality", "AIFF 48kHz", "Alpha Only", "Multi-Machine Sequence"
];

class OutputModule {
  constructor(item, templates) {
    this.item = item;
    this.templates = templates.slice();
    this.applied = null;
    this.file = null;
    this.stale = false;
  }
  /**
   * Applying a template REPLACES the item's output module.
   *
   * After Effects invalidates the OutputModule object when its settings
   * change, so a reference taken before applyTemplate() is stale afterwards
   * and writes to it go nowhere. Modelled here because the host script has to
   * re-read the module, and a fake that quietly kept working would let that
   * bug ship -- the whole reason this file exists.
   */
  applyTemplate(name) {
    if (this.templates.indexOf(name) === -1) {
      throw new Error("no output module template named " + name);
    }
    this.applied = name;
    this.stale = true;
    const fresh = new OutputModule(this.item, this.templates);
    fresh.applied = name;
    this.item._modules[0] = fresh;
  }
}

class RenderQueueItem {
  constructor(queue, comp, templates) {
    this.queue = queue;
    this.comp = comp;
    this.render = true;
    this.status = "queued";
    this._modules = [new OutputModule(this, templates)];
  }
  outputModule(i) {
    const found = this._modules[i - 1];
    if (!found) throw new Error("no output module " + i);
    return found;
  }
  remove() {
    const i = this.queue._items.indexOf(this);
    if (i !== -1) this.queue._items.splice(i, 1);
  }
}

class RenderQueue {
  constructor(options = {}) {
    this._items = [];
    this._templates = options.templates || DEFAULT_TEMPLATES;
    // Set to a header-sized value to simulate a render that produced a valid
    // but sample-less file — what Render Settings with Audio Output off does.
    this._renderedBytes = options.renderedBytes === undefined
      ? DEFAULT_RENDERED_BYTES
      : options.renderedBytes;
    // Every item render() actually rendered, in order — the whole point of
    // the queue fake, since renderQueue.render() renders EVERYTHING enabled.
    this.rendered = [];
    // How deep app's undo stack was when render() ran. After Effects does its
    // own undo bookkeeping during a render, so a script group held open
    // across one comes back unbalanced.
    this.undoDepthAtRender = null;
    this.items = {
      add: (comp) => {
        const item = new RenderQueueItem(this, comp, this._templates);
        this._items.push(item);
        return item;
      }
    };
    Object.defineProperty(this.items, "length", { get: () => this._items.length });
  }
  get numItems() { return this._items.length; }
  item(i) {
    const found = this._items[i - 1];
    if (!found) throw new Error("no render queue item " + i);
    return found;
  }
  render() {
    this.undoDepthAtRender = app._undoStack.length;
    this._items.forEach((item) => {
      if (!item.render) return;
      this.rendered.push(item);
      item.status = "done";
      const om = item._modules[0];
      if (om.file) writtenFiles.set(om.file.fsName, this._renderedBytes);
    });
  }
}

/**
 * Files the fake render queue produced, mapped to their size in bytes.
 *
 * A Map rather than a Set because size is the difference between a render
 * that worked and one that ran with audio switched off: the second still
 * produces a real, openable file, just a header with no samples after it.
 * That is what shipped as "0 words -> 0 captions" to a real user, so the
 * fake has to be able to represent it. `.has()` still works for File.exists.
 */
const writtenFiles = new Map();

/** Text written through File.open("w") / write / close, by path. */
const writtenText = new Map();

/**
 * Folders that exist. The project's own folder is always there; anything else
 * has to be created, which is what makes "the export creates Capset SRT"
 * testable rather than assumed.
 */
const existingFolders = new Set();

/** A plausible size for a few seconds of uncompressed PCM. */
const DEFAULT_RENDERED_BYTES = 1764044;

// --- project ----------------------------------------------------------------

class CompItem {
  constructor(name, width = 1920, height = 1080, duration = 10, frameRate = 30) {
    this.id = nextId++;
    this.name = name;
    this.width = width;
    this.height = height;
    this.duration = duration;
    this.frameRate = frameRate;
    this.frameDuration = 1 / frameRate;
    this.workAreaStart = 0;
    this.workAreaDuration = duration;
    // The playhead, and how the timeline labels time. displayStartTime is a
    // comp that starts at, say, 01:00:00:00; dropFrame only means anything at
    // 29.97 and 59.94.
    this.time = 0;
    this.displayStartTime = 0;
    this.dropFrame = false;
    this.layers = new LayerCollection(this);
  }
  get numLayers() { return this.layers._layers.length; }
  layer(i) {
    const found = this.layers._layers[i - 1];
    if (!found) throw new Error("no layer at index " + i);
    return found;
  }
  get selectedLayers() { return this.layers._layers.filter((l) => l.selected); }
  remove() {
    const i = project.items.indexOf(this);
    if (i !== -1) project.items.splice(i, 1);
  }
}

let project = null;

/** Records menu commands so clipboard-driven code can be inspected. */
const commandLog = [];

const app = {
  project: null,
  _undoStack: [],
  beginUndoGroup(name) { app._undoStack.push(name); },
  endUndoGroup() { app._undoStack.pop(); },
  findMenuCommandId(name) { return { Copy: 18, Paste: 19 }[name] || 0; },
  executeCommand(id) { commandLog.push(id); }
};

function reset(options = {}) {
  nextId = 1;
  commandLog.length = 0;
  app._undoStack.length = 0;
  // Cleared on every reset so one test's fake Character panel never leaks
  // into the next; a test that needs it set calls setCharacterPanelDefaults
  // itself, after reset (see jsx-host.js's `load`).
  characterPanelDefaults = null;
  const comp = new CompItem(
    options.name || "Comp 1",
    options.width || 1920, options.height || 1080,
    options.duration || 30, options.frameRate || 30
  );
  writtenFiles.clear();
  writtenText.clear();
  existingFolders.clear();
  existingFolders.add("/projects");
  project = {
    items: [comp],
    activeItem: comp,
    renderQueue: new RenderQueue({
      templates: options.templates,
      renderedBytes: options.renderedBytes
    }),
    expressionEngine: options.expressionEngine || "javascript-1.0",
    // A saved project has a file; an unsaved one has null, which is the
    // branch the SRT export has to refuse politely rather than crash on.
    // `undefined` in options means "saved, in the default place".
    file: options.projectFile === undefined
      ? { fsName: "/projects/Demo.aep", parent: { fsName: "/projects" } }
      : options.projectFile,
    numItems: 1,
    item(i) { return project.items[i - 1]; }
  };
  Object.defineProperty(project, "numItems", { get: () => project.items.length });
  app.project = project;
  return comp;
}

module.exports = {
  reset, app, commandLog, writtenFiles, writtenText, existingFolders,
  RenderQueue, RenderQueueItem, OutputModule, DEFAULT_TEMPLATES,
  get project() { return project; },
  CompItem, TextLayer, AVLayer, ShapeLayer, Layer,
  Property, PropertyGroup, TextDocument, setCharacterPanelDefaults,
  KeyframeEase, ParagraphJustification
};
