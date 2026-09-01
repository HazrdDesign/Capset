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
    JSON, Math, Date, String, Number, Array, Object, Error, RegExp, isNaN, parseInt, parseFloat,
    // ExtendScript globals the script probes. Overridable per test.
    $: options.$ || { os: "Windows", getenv: () => null, writeln: () => {} },
    File: options.File || function File() { return { exists: false }; },
    Folder: options.Folder || function Folder() { return { fsName: "/tmp" }; }
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
