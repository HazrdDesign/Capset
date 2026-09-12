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
const REPO = path.join(ROOT, "..");
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

test("a healthy service costs no vertical space", () => {
  // An After Effects panel is docked into a column a few hundred pixels wide,
  // and the status row was the largest thing in it while saying the least:
  // "Ready — nemo-parakeet-tdt-0.6b-v3" is not information anyone acts on.
  // Healthy is a dot in the tab row; everything else still gets the full row,
  // because those are the states the user has to do something about.
  const src = functionBody("setStatus");
  assert.ok(/hidden\s*=\s*kind === "ok"/.test(src),
            "setStatus does not hide the status row when the service is fine");
  assert.ok(/\$\("status-dot"\)/.test(src),
            "setStatus never updates the compact indicator");
  assert.ok(/dot\.title/.test(src),
            "the dot carries no message, so a collapsed status says nothing at all");

  // The row must start collapsed, or the panel flashes it on every open.
  assert.ok(/<section id="status"[^>]*\bhidden\b/.test(html),
            "the status row is not hidden in the markup");
  assert.ok(main.includes('$("status-dot").addEventListener'),
            "the dot cannot re-check, so a collapsed status is a dead end");
});

test("the button that deletes captions reads as destructive", () => {
  // One click from the button that builds them, on layers the user has
  // usually just spent time styling.
  const css = fs.readFileSync(path.join(ROOT, "css", "panel.css"), "utf8");
  assert.ok(/<button id="clear"[^>]*class="[^"]*\bdanger\b/.test(html),
            "Remove all Capset captions is not marked as destructive");
  const rule = css.slice(css.indexOf("button.danger {"),
                         css.indexOf("}", css.indexOf("button.danger {")));
  assert.ok(/var\(--err/.test(rule), "the danger button is not coloured by --err");
});

test("SRT export formats with the tested module, not in ExtendScript", () => {
  // Timecode arithmetic is worth testing, and ExtendScript is where tests are
  // hardest to run. The host reads the layers and writes the file; the
  // formatting happens here, where srt.test.js can reach it.
  const src = functionBody("exportSrt");
  assert.ok(/srt\.format\(/.test(src), "exportSrt does not use the SRT module");
  assert.ok(/capsetCaptionsForExport/.test(src),
            "exportSrt does not read the captions off the timeline");
  assert.ok(/capsetWriteSrt/.test(src), "exportSrt never asks the host to write");

  const jsx = fs.readFileSync(path.join(ROOT, "jsx", "capset.jsx"), "utf8");
  assert.ok(!/-->/.test(jsx),
            "the host script is formatting SRT cues itself; that belongs in js/lib/srt.js");
});

test("nothing dormant is loaded by the panel", () => {
  // The Animate tab was removed, not left hidden: a tab that ships but never
  // appears is dead weight in every install, and its libraries would still be
  // parsed on every panel open. See panel/dormant/README.md.
  assert.ok(!/data-tab="animate"/.test(html), "the Animate tab is still in the markup");
  const dormant = scripts.filter((src) => src.includes("dormant"));
  assert.deepStrictEqual(dormant, [], "index.html loads dormant code");
  ["preview.js", "presets.js", "timing.js"].forEach((f) => {
    assert.ok(!scripts.includes("js/lib/" + f),
              f + " is loaded but has no live caller");
  });
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
  const settingIds = ["mode", "opt-precompose", "opt-parent"];

  // Everything downstream of the click, whether or not it is async itself.
  const downstream = ["build", "captionsFromTranscription"];

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
  ["mode", "opt-precompose", "opt-parent"]
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

test("the host keeps the machinery a rebuilt animation feature needs", () => {
  // The Animate tab is gone (panel/dormant/README.md), but what talks to
  // After Effects stayed: generating animators under the Capset__ prefix and
  // tearing them down exactly is the hard, tested part, and it is what any
  // replacement writes into. Deleting it would mean rebuilding it first.
  const jsx = fs.readFileSync(path.join(ROOT, "jsx", "capset.jsx"), "utf8");
  ["capsetApplyAnimation", "capsetRemoveAnimators", "capsetAddPhase",
   "capsetCaptionLayerTimes"].forEach((fn) => {
    assert.ok(new RegExp("function " + fn + "\\(").test(jsx),
              fn + " was removed from the host script");
  });
});

// --- the animation library ---------------------------------------------------

test("every field in animations.json is read by something", () => {
  // The sibling of "every input in the panel is actually read", and written
  // for the same reason: `overshoot` sat in every preset for weeks while
  // nothing read it, so every "pop" and "bounce" in the library was a plain
  // interpolation. A field nobody reads looks identical to one that works.
  const lib = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "dormant", "animation", "animations.json"), "utf8")
  );
  const sources = ["jsx/capset.jsx", "dormant/animation/preview.js",
                   "dormant/animation/timing.js", "dormant/animation/presets.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");

  const fields = new Set();
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      Object.keys(node).forEach((k) => { fields.add(k); walk(node[k]); });
    }
  })(lib.animations);

  // Descriptive metadata, not behaviour the definition promises. `name` and
  // `description` were rendered by the Animate tab's grid and are read by
  // nothing now that it is gone; they stay in the library because whatever
  // replaces that tab will need something to label a definition with.
  const metadata = new Set(["tags", "description"]);

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

test("every segmentation option is a mode the library understands", () => {
  const seg = require("../js/lib/segmentation.js");
  const block = html.match(/<select id="mode">([\s\S]*?)<\/select>/);
  assert.ok(block, "the segmentation select is gone");
  const offered = [...block[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);

  assert.deepStrictEqual(offered, ["smart", "sentence", "one"],
    "the segmentation list changed; keep it short and keep this in step");

  // A value the library does not know silently falls through to phrase
  // pacing, which looks like the mode simply not working.
  const words = [
    { text: "a", start: 0, end: 0.2 }, { text: "b", start: 0.3, end: 0.5 },
    { text: "c", start: 0.6, end: 0.8 }, { text: "d", start: 0.9, end: 1.1 }
  ];
  offered.forEach((mode) => {
    const out = seg.segment(words, { mode, width: 1080, height: 1920 });
    assert.strictEqual(out.mode, mode,
      "\"" + mode + "\" is offered but segment() resolved it as " + out.mode);
  });
});

test("captions are inserted without an animation", () => {
  // Inserting captions and choosing how they move are separate decisions.
  // This used to pass whichever preset happened to be selected in the Motion
  // tab, so every insert arrived pre-animated with something unasked for.
  // main.js cannot be executed under node, so this is a source check.
  const at = main.indexOf("capsetBuildCaptions");
  assert.notStrictEqual(at, -1, "the capsetBuildCaptions call has moved");
  const call = main.slice(at, at + 900);
  const animationArg = call.match(/^\s*animation:\s*(.+?),\s*$/m);
  assert.ok(animationArg, "no animation argument found in the build payload");
  assert.strictEqual(animationArg[1], "null",
    "the insert path passes " + animationArg[1] + "; the Motion tab applies those");
});

test("a work-area run tells the host to replace only that range", () => {
  // The scoping itself lives in the host and is covered there. But the host
  // only scopes when the panel hands it a range, and a panel that sends null
  // for every run looks exactly like the feature not existing. main.js cannot
  // be executed under node, so this is a source check.
  const at = main.indexOf("capsetBuildCaptions");
  assert.notStrictEqual(at, -1, "the capsetBuildCaptions call has moved");
  const call = main.slice(at, at + 1400);

  const arg = call.match(/^\s*replaceRange:\s*(.+?),?\s*$/m);
  assert.ok(arg, "the build payload carries no replaceRange");
  assert.match(arg[1], /payload\.range/,
    "replaceRange is " + arg[1] + ", which the host cannot scope by");

  assert.match(main, /range:\s*settings\.scope === "inout"/,
    "the replace range is not tied to the In to Out scope, so either every " +
    "run is partial or none is");
});
