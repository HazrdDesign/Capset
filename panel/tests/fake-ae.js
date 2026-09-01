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
class TextDocument {
  constructor(text) {
    this.text = text;
    this.font = "Arial";
    this.fontSize = 72;
    this.tracking = 0;
    this.leading = 86.4;
    this.justification = ParagraphJustification.LEFT_JUSTIFY;
    this.applyFill = true;
    this.applyStroke = false;
    this.strokeWidth = 0;
    this.strokeOverFill = false;
    this.fillColor = [1, 1, 1];
    this.strokeColor = [0, 0, 0];
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
          selector._add(new Property("Offset", "ADBE Text Percent Offset", 0));
          return selector;
        }
      }));
      return animator;
    }
  });
}

// --- layers -----------------------------------------------------------------

class Layer {
  constructor(comp, name) {
    this.id = nextId++;
    this.containingComp = comp;
    this.name = name;
    this.inPoint = 0;
    this.outPoint = comp ? comp.duration : 0;
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
    Object.defineProperty(sourceText, "value", {
      get() { return Object.assign(new TextDocument(""), this._value); },
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
  }
  applyTemplate(name) {
    if (this.templates.indexOf(name) === -1) {
      throw new Error("no output module template named " + name);
    }
    this.applied = name;
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
    // Every item render() actually rendered, in order — the whole point of
    // the queue fake, since renderQueue.render() renders EVERYTHING enabled.
    this.rendered = [];
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
    this._items.forEach((item) => {
      if (!item.render) return;
      this.rendered.push(item);
      item.status = "done";
      const om = item._modules[0];
      if (om.file) writtenFiles.add(om.file.fsName);
    });
  }
}

/** Files the fake render queue produced, so File.exists can answer. */
const writtenFiles = new Set();

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
  const comp = new CompItem(
    options.name || "Comp 1",
    options.width || 1920, options.height || 1080,
    options.duration || 30, options.frameRate || 30
  );
  writtenFiles.clear();
  project = {
    items: [comp],
    activeItem: comp,
    renderQueue: new RenderQueue({ templates: options.templates }),
    expressionEngine: options.expressionEngine || "javascript-1.0",
    numItems: 1,
    item(i) { return project.items[i - 1]; }
  };
  Object.defineProperty(project, "numItems", { get: () => project.items.length });
  app.project = project;
  return comp;
}

module.exports = {
  reset, app, commandLog, writtenFiles,
  RenderQueue, RenderQueueItem, OutputModule, DEFAULT_TEMPLATES,
  get project() { return project; },
  CompItem, TextLayer, AVLayer, ShapeLayer, Layer,
  Property, PropertyGroup, TextDocument,
  KeyframeEase, ParagraphJustification
};
