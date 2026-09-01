const test = require("node:test");
const assert = require("node:assert");
const { UpdateChecker, compareVersions, isNewer } = require("../js/lib/updates.js");

// --- version comparison ---------------------------------------------------

test("compares versions numerically, not as strings", () => {
  // The classic bug: "0.1.10" < "0.1.9" lexicographically, but 10 > 9.
  assert.strictEqual(compareVersions("0.1.10", "0.1.9"), 1);
  assert.strictEqual(compareVersions("0.1.9", "0.1.10"), -1);
  assert.strictEqual(compareVersions("1.0.0", "0.9.9"), 1);
});

test("equal versions compare equal", () => {
  assert.strictEqual(compareVersions("1.2.3", "1.2.3"), 0);
});

test("missing trailing segments count as zero", () => {
  assert.strictEqual(compareVersions("1.2", "1.2.0"), 0);
  assert.strictEqual(compareVersions("1.2.1", "1.2"), 1);
});

test("a leading v is ignored", () => {
  assert.strictEqual(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.strictEqual(compareVersions("V2.0", "1.9.9"), 1);
});

test("a pre-release sorts before its release", () => {
  assert.strictEqual(compareVersions("1.0.0-beta", "1.0.0"), -1);
  assert.strictEqual(compareVersions("1.0.0", "1.0.0-beta"), 1);
  assert.strictEqual(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
});

test("garbage input does not throw or produce NaN ordering", () => {
  for (const bad of [null, undefined, "", "abc", "1.x.3"]) {
    const result = compareVersions(bad, "1.0.0");
    assert.ok(result === -1 || result === 0 || result === 1, `bad result for ${bad}`);
  }
});

test("isNewer is strict", () => {
  assert.strictEqual(isNewer("0.2.0", "0.1.4"), true);
  assert.strictEqual(isNewer("0.1.4", "0.1.4"), false);
  assert.strictEqual(isNewer("0.1.3", "0.1.4"), false);
});

// --- checker --------------------------------------------------------------

function stubFetch(body, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => body });
}

function memoryStorage() {
  const map = {};
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); }
  };
}

function checker(extra) {
  return new UpdateChecker(Object.assign({
    manifestUrl: "https://example.test/latest.json",
    currentVersion: "0.1.4",
    storage: memoryStorage(),
    intervalMs: 0
  }, extra));
}

test("reports an available update", async () => {
  const c = checker({
    fetch: stubFetch({ version: "0.2.0", url: "https://buy.test", notes: "New stuff" })
  });
  const result = await c.check();
  assert.strictEqual(result.status, "update");
  assert.strictEqual(result.version, "0.2.0");
  assert.strictEqual(result.url, "https://buy.test");
  assert.strictEqual(result.required, false);
});

test("reports current when the manifest matches", async () => {
  const c = checker({ fetch: stubFetch({ version: "0.1.4" }) });
  assert.strictEqual((await c.check()).status, "current");
});

test("an older manifest is not treated as an update", async () => {
  const c = checker({ fetch: stubFetch({ version: "0.1.0" }) });
  assert.strictEqual((await c.check()).status, "current");
});

test("flags a required update when below the manifest minimum", async () => {
  const c = checker({ fetch: stubFetch({ version: "0.3.0", minimum: "0.2.0" }) });
  assert.strictEqual((await c.check()).required, true);
});

test("being offline is reported, never thrown", async () => {
  // Offline is normal. It must not look like the plugin is broken.
  const c = checker({ fetch: async () => { throw new Error("ECONNREFUSED"); } });
  const result = await c.check();
  assert.strictEqual(result.status, "unavailable");
  assert.match(result.reason, /ECONNREFUSED/);
});

test("an HTTP error is reported, never thrown", async () => {
  const c = checker({ fetch: stubFetch(null, false, 500) });
  assert.strictEqual((await c.check()).status, "unavailable");
});

test("a malformed manifest is reported, never thrown", async () => {
  const c = checker({ fetch: stubFetch({ nope: true }) });
  const result = await c.check();
  assert.strictEqual(result.status, "unavailable");
  assert.match(result.reason, /Malformed/);
});

test("no configured url means no network call at all", async () => {
  let called = false;
  const c = checker({ manifestUrl: null, fetch: async () => { called = true; } });
  assert.strictEqual((await c.check()).status, "unavailable");
  assert.strictEqual(called, false);
});

test("throttles repeat checks within the interval", async () => {
  let calls = 0;
  const c = checker({
    intervalMs: 60000,
    fetch: async () => { calls++; return { ok: true, status: 200, json: async () => ({ version: "0.2.0" }) }; }
  });
  assert.strictEqual((await c.check()).status, "update");
  assert.strictEqual((await c.check()).status, "skipped");
  assert.strictEqual(calls, 1, "should not hit the network twice inside the window");
});

test("force overrides the throttle", async () => {
  let calls = 0;
  const c = checker({
    intervalMs: 60000,
    fetch: async () => { calls++; return { ok: true, status: 200, json: async () => ({ version: "0.2.0" }) }; }
  });
  await c.check();
  assert.strictEqual((await c.check(true)).status, "update");
  assert.strictEqual(calls, 2);
});

test("checks again once the interval has elapsed", async () => {
  let now = 1000;
  let calls = 0;
  const c = checker({
    intervalMs: 500,
    now: () => now,
    fetch: async () => { calls++; return { ok: true, status: 200, json: async () => ({ version: "0.2.0" }) }; }
  });
  await c.check();
  now += 600;
  await c.check();
  assert.strictEqual(calls, 2);
});

test("a failed check does not start the throttle clock", async () => {
  // Otherwise one offline moment suppresses checks for a whole day.
  let mode = "fail";
  let calls = 0;
  const c = checker({
    intervalMs: 60000,
    fetch: async () => {
      calls++;
      if (mode === "fail") throw new Error("offline");
      return { ok: true, status: 200, json: async () => ({ version: "0.2.0" }) };
    }
  });
  assert.strictEqual((await c.check()).status, "unavailable");
  mode = "ok";
  assert.strictEqual((await c.check()).status, "update");
  assert.strictEqual(calls, 2);
});

test("blocked storage does not break checking", async () => {
  const hostile = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); }
  };
  const c = checker({ storage: hostile, fetch: stubFetch({ version: "0.2.0" }) });
  assert.strictEqual((await c.check()).status, "update");
});
