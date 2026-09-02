/**
 * Static checks on the ExtendScript host file.
 *
 * ExtendScript is ES3. A single ES5 construct is not a runtime error that
 * breaks one function -- it is a PARSE error that makes the whole file fail
 * to load, so every Capset button stops working at once with only "EvalScript
 * error." to go on. That failure is invisible until the panel is opened
 * inside After Effects, which is exactly why it is worth catching here.
 *
 * This is a lint, not a parser: it catches the constructs that have actually
 * bitten, not every possible one. Array.prototype.indexOf is deliberately
 * absent -- it is ES5, but String.prototype.indexOf is ES3 and far more
 * common here, and a regex cannot tell them apart.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const JSX_PATH = path.join(__dirname, "..", "jsx", "capset.jsx");
const source = fs.readFileSync(JSX_PATH, "utf8");

/** Strip comments and string literals so prose cannot trip the patterns. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

const stripped = code(source);

const banned = [
  [/\blet\s+[A-Za-z_$]/, "let"],
  [/\bconst\s+[A-Za-z_$]/, "const"],
  [/=>/, "arrow function"],
  [/`/, "template literal"],
  [/\.\.\./, "spread or rest"],
  [/\.forEach\s*\(/, "Array.prototype.forEach"],
  [/\.map\s*\(/, "Array.prototype.map"],
  [/\.filter\s*\(/, "Array.prototype.filter"],
  [/\.reduce\s*\(/, "Array.prototype.reduce"],
  [/\.trim\s*\(/, "String.prototype.trim"],
  [/\bObject\.keys\b/, "Object.keys"],
  [/\bArray\.isArray\b/, "Array.isArray"],
  [/\bclass\s+[A-Za-z_$]/, "class"],
  [/\bfunction\s*\*/, "generator"],
];

for (const [pattern, name] of banned) {
  test(`capset.jsx uses no ${name}`, () => {
    const lines = stripped.split("\n");
    const hits = [];
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${i + 1}: ${source.split("\n")[i].trim()}`);
    });
    assert.deepStrictEqual(
      hits, [],
      `${name} is ES5+; ExtendScript cannot parse the file at all:\n${hits.join("\n")}`
    );
  });
}

test("no unescaped / follows \\\\ inside a regex character class", () => {
  // [^.\\/] parses fine under Node's vm sandbox (jsx-host.js) -- V8 follows
  // spec, where / needs no escaping inside a character class. ExtendScript's
  // own regex-literal scanner does not reliably track character-class state
  // though: an escaped backslash (\\) immediately followed by a bare /
  // reads as the end of the regex literal, corrupting everything after it
  // into stray tokens ("Expected: )"). Bit capset.jsx:660 in real After
  // Effects while every execution-based test here stayed green.
  const pattern = /\[[^\]\n]*(?<!\\)\\\\\/[^\]\n]*\]/;
  const lines = source.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (pattern.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepStrictEqual(
    hits, [],
    `escape the / (as \\/) in these character classes -- ExtendScript's regex ` +
    `scanner can end the literal early otherwise:\n${hits.join("\n")}`
  );
});

test("every function returns through the ok/error envelope", () => {
  // host() in main.js parses the response as JSON and reads .ok. A host
  // function that returns a bare value makes the panel report "Unexpected
  // host response" with no clue which call misbehaved.
  assert.ok(/function capsetOk\(/.test(source));
  assert.ok(/function capsetErr\(/.test(source));
});

// --- port file path ---------------------------------------------------------
//
// capsetPortFile duplicates logging_setup.data_dir() from the backend, because
// neither runtime can read the other's constants. backend/tests/test_paths.py
// pins the same two paths from the Python side, so if either moves, one of the
// two suites fails instead of the panel quietly failing to find a running
// service.

test("the Windows port file path matches the backend", () => {
  assert.match(source, /local \+ "\\\\Capset"/);
  assert.match(source, /\$\.getenv\("LOCALAPPDATA"\)/);
});

test("the macOS port file path matches the backend", () => {
  assert.match(source, /"~\/Library\/Application Support\/Capset"/);
});
