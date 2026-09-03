/**
 * Checks that the panel is actually assembled.
 *
 * These catch the failures that unit tests structurally cannot: a library
 * that is tested but never loaded, or a getElementById for an element that
 * does not exist. Both produce a panel that throws on load and shows nothing,
 * and neither is visible until it is opened inside After Effects.
 *
 * Written after adding js/lib/launcher.js and forgetting its <script> tag —
 * every launcher test passed while the panel would have died on the first
 * reference to CapsetLauncher.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");

const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
const libs = fs.readdirSync(path.join(ROOT, "js", "lib")).filter((f) => f.endsWith(".js"));

test("every library is loaded by index.html", () => {
  const missing = libs.filter((f) => !scripts.includes("js/lib/" + f));
  assert.deepStrictEqual(missing, [], "library present but never loaded");
});

test("libraries load before main.js", () => {
  const mainIndex = scripts.indexOf("js/main.js");
  assert.notStrictEqual(mainIndex, -1, "main.js is not loaded at all");
  libs.forEach((f) => {
    assert.ok(
      scripts.indexOf("js/lib/" + f) < mainIndex,
      f + " loads after main.js, so its global is undefined when main.js runs"
    );
  });
});

test("every Capset global main.js uses is exported by a loaded library", () => {
  // Globals the libraries attach to the window, plus the vendored CSInterface.
  const exported = new Set(["CSInterface", "SystemPath"]);
  libs.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, "js", "lib", f), "utf8");
    [...src.matchAll(/root\.([A-Za-z_$][\w$]*)\s*=/g)].forEach((m) => exported.add(m[1]));
  });

  // Names main.js defines itself must not be mistaken for globals.
  const local = new Set(
    [...main.matchAll(/\b(?:function|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  );

  // Not preceded by a dot: CapsetBackendLib.CapsetBackend is a property of a
  // global, not a global of its own.
  const used = new Set(
    [...main.matchAll(/(^|[^.\w$])(Capset[A-Za-z_$][\w$]*)\b/g)].map((m) => m[2])
  );

  const unresolved = [...used].filter((n) => !exported.has(n) && !local.has(n));
  assert.deepStrictEqual(
    unresolved, [],
    "main.js references globals no loaded library defines"
  );
});

test("every element main.js looks up exists in index.html", () => {
  const ids = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  );
  const looked = [...main.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(looked)].filter((id) => !ids.has(id));
  assert.deepStrictEqual(
    missing, [],
    "getElementById returns null for these, so the panel throws on load"
  );
});

test("every log kind main.js uses has a style", () => {
  // A kind with no rule still renders, just not as a warning — the message
  // the user most needs to notice would look like ordinary output.
  const css = fs.readFileSync(path.join(ROOT, "css", "panel.css"), "utf8");
  const kinds = new Set(
    [...main.matchAll(/\blog\((?:[^;]*?),\s*"(\w+)"\)/g)].map((m) => m[1])
  );
  const missing = [...kinds].filter((k) => !css.includes("#log ." + k));
  assert.deepStrictEqual(missing, [], "log kinds with no stylesheet rule");
});

test("every input in the panel is actually read", () => {
  // A decorative control is a promise the plugin does not keep, and this
  // codebase has shipped several: "Include effects" was sent to the host and
  // ignored, and every animation's `overshoot` was read by nothing at all.
  // A checkbox nobody reads looks identical to one that works.
  const ids = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)]
    .map((m) => m[1]);
  const unread = ids.filter((id) => !main.includes('$("' + id + '")'));
  assert.deepStrictEqual(unread, [], "controls the panel never reads");
});

test("every radio group is read", () => {
  const names = new Set(
    [...html.matchAll(/<input\b[^>]*type="radio"[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
  );
  const unread = [...names].filter((name) => !main.includes('radio("' + name + '")'));
  assert.deepStrictEqual(unread, [], "radio groups the panel never reads");
});

// --- settings snapshot ------------------------------------------------------
//
// The panel's controls stay live while a run is in flight, because a
// transcription takes minutes and locking the panel for its duration is worse.
// That is only safe if the run reads its settings ONCE, at the click. These
// used to be read inside the promise chain -- segmentationMode() at the point
// the transcription came back -- so changing the mode dropdown mid-run silently
// changed the captions that came out, with nothing to indicate why.

/** Source of one top-level function in main.js, up to the next one. */
function functionBody(name) {
  const start = main.indexOf("  function " + name + "(");
  assert.notStrictEqual(start, -1, name + " is not a top-level function in main.js");
  const rest = main.slice(start + 1);
  const end = rest.indexOf("\n  function ");
  return end === -1 ? rest : rest.slice(0, end);
}

test("the run path reads no live controls after the click", () => {
  // Controls whose value decides what a run produces. Reading any of these
  // after the click means the result can disagree with what was clicked.
  const settingIds = [
    "mode", "opt-split", "resolve",
    "opt-precompose", "opt-parent", "opt-titlesafe"
  ];

  // Everything downstream of the click, whether or not it is async itself.
  const downstream = ["build", "captionsFromTranscription", "timingsFor"];

  const offenders = [];
  downstream.forEach((name) => {
    const src = functionBody(name);
    settingIds.forEach((id) => {
      if (src.includes('$("' + id + '")')) offenders.push(name + " reads $(\"" + id + "\")");
    });
    if (/\bradio\(/.test(src)) offenders.push(name + " calls radio()");
  });

  assert.deepStrictEqual(
    offenders, [],
    "these read a live control after the run started; take the value from the " +
    "captureSettings() snapshot instead:\n" + offenders.join("\n")
  );
});

test("captureSettings covers every control the run depends on", () => {
  // The snapshot is only worth having if it is complete: a setting left out of
  // it is a setting still read live, or one silently dropped from the run.
  const src = functionBody("captureSettings");
  ["mode", "opt-split", "resolve", "opt-precompose", "opt-parent", "opt-titlesafe"]
    .forEach((id) => {
      assert.ok(
        src.includes('$("' + id + '")'),
        'captureSettings() does not snapshot $("' + id + '")'
      );
    });
  ["source", "duration"].forEach((name) => {
    assert.ok(
      src.includes('radio("' + name + '")'),
      "captureSettings() does not snapshot radio(\"" + name + "\")"
    );
  });
});

// --- the rest of the audit fixes -------------------------------------------

test("the log is capped", () => {
  // Every stage of every chunk logs a line. Uncapped, the panel's DOM grows for
  // as long as it stays open, and a long video is exactly when it matters.
  const src = functionBody("log");
  assert.ok(/LOG_MAX_LINES/.test(src), "log() does not consult a line cap");
  assert.ok(/removeChild/.test(src), "log() never removes an old line");
});

test("port discovery cannot inherit the ten-minute host timeout", () => {
  // It runs on every health check including startup, and has a working
  // fallback, so it must never be able to hold the panel open for ten minutes.
  const src = functionBody("publishedPort");
  assert.ok(
    /capsetBackendPort\(\)",\s*DISCOVERY_TIMEOUT_MS/.test(src),
    "publishedPort() does not pass a short timeout, so it inherits HOST_TIMEOUT_MS"
  );
  const timeout = main.match(/var DISCOVERY_TIMEOUT_MS\s*=\s*([^;]+);/);
  assert.ok(timeout, "DISCOVERY_TIMEOUT_MS is not defined");
  // eslint-disable-next-line no-eval
  assert.ok(eval(timeout[1]) <= 10 * 1000, "discovery timeout is not short");
});

test("removing every caption asks first", () => {
  // One click from the button that builds them, and the user has usually just
  // spent time styling the thing it deletes.
  const src = functionBody("clearCaptions");
  const confirmAt = src.indexOf("confirm(");
  const hostAt = src.indexOf("host(");
  assert.notStrictEqual(confirmAt, -1, "clearCaptions() does not confirm");
  assert.ok(
    confirmAt < hostAt,
    "clearCaptions() calls the host before confirming, so the layers are " +
    "already gone by the time the user is asked"
  );
});

test("capture refreshes the comp it is capturing from", () => {
  // The captured dimensions are what a later Sync scales by. state.compInfo is
  // null until the first build and stale after switching comps, so trusting it
  // could record a 16:9 comp's size for a style captured in a 9:16 one.
  const src = functionBody("capture");
  assert.ok(
    src.indexOf("capsetGetCompInfo()") !== -1,
    "capture() reuses whatever comp info was left behind by the last build"
  );
  assert.ok(
    src.indexOf("capsetGetCompInfo()") < src.indexOf("capsetCaptureStyle()"),
    "capture() reads the comp info after capturing, which is too late"
  );
});

test("re-applying an animation sends real timings, not an empty map", () => {
  // applyAnimation used to post `timingsById: {}`, so the host fell through to
  // a hardcoded copy of the fraction rules and the length chosen in the panel
  // was ignored on every layer. That is most of why the timing controls
  // appeared to do nothing.
  const src = functionBody("applyAnimation");
  assert.ok(
    /capsetCaptionLayerTimes/.test(src),
    "applyAnimation does not ask the host for layer durations, so it cannot " +
    "compute real timings"
  );
  assert.ok(
    /timingsFor\(/.test(src),
    "applyAnimation does not use timingsFor(), the one tested implementation"
  );
  assert.ok(
    !/timingsById:\s*\{\s*\}/.test(src),
    "applyAnimation still sends an empty timings map"
  );
});

test("the host's fallback timing rules are a last resort, not the norm", () => {
  // A second copy of the fraction rules lives in capset.jsx for layers the
  // panel knows nothing about. It is allowed to exist, but nothing in the
  // normal path should be relying on it.
  const jsx = fs.readFileSync(path.join(ROOT, "jsx", "capset.jsx"), "utf8");
  assert.ok(
    /capsetCaptionLayerTimes/.test(jsx),
    "the host cannot report layer durations, so the panel cannot avoid the fallback"
  );
});

// --- the animation library ---------------------------------------------------

test("every field in animations.json is read by something", () => {
  // The sibling of "every input in the panel is actually read", and written
  // for the same reason: `overshoot` sat in every preset for weeks while
  // nothing read it, so every "pop" and "bounce" in the library was a plain
  // interpolation. A field nobody reads looks identical to one that works.
  const lib = JSON.parse(
    fs.readFileSync(path.join(ROOT, "animations", "animations.json"), "utf8")
  );
  const sources = ["jsx/capset.jsx", "js/main.js", "js/lib/preview.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");

  const fields = new Set();
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      Object.keys(node).forEach((k) => { fields.add(k); walk(node[k]); });
    }
  })(lib.animations);

  // Descriptive metadata for the grid, not behaviour the definition promises.
  const metadata = new Set(["tags"]);

  const unread = [...fields].filter((k) =>
    !k.startsWith("$") && !metadata.has(k) &&
    !sources.includes("." + k) &&
    !sources.includes('"' + k + '"') &&
    !sources.includes("'" + k + "'")
  );

  assert.deepStrictEqual(
    unread, [],
    "animation fields nothing reads — every preset declaring these is lying " +
    "about what it does: " + unread.join(", ")
  );
});
