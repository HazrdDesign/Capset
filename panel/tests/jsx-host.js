/**
 * Loads panel/jsx/capset.jsx into a sandbox backed by tests/fake-ae.js.
 *
 * The file is executed verbatim apart from stripping `#include` (an
 * ExtendScript preprocessor directive, not JavaScript) — json2.jsx exists to
 * give ExtendScript a JSON object, which node already has.
 *
 * Host functions return JSON strings through capsetOk/capsetErr, exactly as
 * the panel receives them, so `call()` parses that envelope and throws on the
 * error branch. That means these tests exercise the same contract main.js
 * relies on.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fake = require("./fake-ae.js");

const JSX_PATH = path.join(__dirname, "..", "jsx", "capset.jsx");

/**
 * ExtendScript's File, backed by the set of paths the fake render queue
 * "wrote". `exists` is the property the render path branches on, so it has to
 * reflect what the render actually produced rather than always answering yes.
 */
function makeFile() {
  function File(fsName) {
    if (!(this instanceof File)) return new File(fsName);
    this.fsName = String(fsName);
  }
  Object.defineProperty(File.prototype, "exists", {
    get() { return fake.writtenFiles.has(this.fsName); }
  });
  File.prototype.open = function () { return false; };
  File.prototype.read = function () { return ""; };
  File.prototype.close = function () {};
  return File;
}

function makeFolder() {
  function Folder(fsName) {
    if (!(this instanceof Folder)) return new Folder(fsName);
    this.fsName = String(fsName || "/tmp");
  }
  Folder.temp = { fsName: "/tmp" };
  Folder.fs = "Windows";
  return Folder;
}

function load(options = {}) {
  const comp = fake.reset(options);
  const source = fs.readFileSync(JSX_PATH, "utf8")
    .replace(/^\s*#include.*$/gm, "");

  const sandbox = {
    app: fake.app,
    CompItem: fake.CompItem,
    TextLayer: fake.TextLayer,
    AVLayer: fake.AVLayer,
    ShapeLayer: fake.ShapeLayer,
    KeyframeEase: fake.KeyframeEase,
    ParagraphJustification: fake.ParagraphJustification,
    // Intrinsics (JSON, Array, Math...) are DELIBERATELY not injected. The vm
    // context has its own, and injecting the host's would break `instanceof
    // Array` for arrays the script builds itself — the branch that decides
    // whether a property is 2D. ExtendScript has one realm; so must this.
    // The cost is that values crossing back out are sandbox-realm objects,
    // which is what plain() in the tests is for.
    //
    // ExtendScript globals the script probes. Overridable per test.
    $: options.$ || { os: "Windows", getenv: () => null, writeln: () => {} },
    File: options.File || makeFile(),
    Folder: options.Folder || makeFolder()
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "capset.jsx" });

  /** Call a host function and unwrap its ok/error envelope. */
  function call(name, payload) {
    const fn = sandbox[name];
    if (typeof fn !== "function") throw new Error("no host function " + name);
    const raw = payload === undefined
      ? fn()
      : fn(JSON.stringify(payload));
    if (typeof raw !== "string") {
      throw new Error(name + " returned " + typeof raw + ", not a JSON envelope");
    }
    const parsed = JSON.parse(raw);
    if (!parsed.ok) {
      const err = new Error(parsed.error);
      err.hostError = true;
      throw err;
    }
    return parsed.data;
  }

  return { comp, call, sandbox, fake };
}

module.exports = { load, JSX_PATH };
