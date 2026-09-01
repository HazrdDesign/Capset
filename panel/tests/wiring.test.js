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
