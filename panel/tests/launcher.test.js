const test = require("node:test");
const assert = require("node:assert");
const { ensureRunning } = require("../js/lib/launcher.js");

const noSleep = () => Promise.resolve();
const DOWN = { status: "unreachable", model_loaded: false, error: "ECONNREFUSED" };
const UP = { status: "ok", model_loaded: true };

/** Health that reports down for the first `n` calls, then up. */
function upAfter(n) {
  let calls = 0;
  const fn = () => Promise.resolve(calls++ < n ? DOWN : UP);
  Object.defineProperty(fn, "calls", { get: () => calls });
  return fn;
}

test("a running service is not restarted", async () => {
  let spawned = 0;
  const health = await ensureRunning({
    health: () => Promise.resolve(UP),
    spawn: () => { spawned++; },
    sleep: noSleep
  });
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(spawned, 0, "spawned a second backend on top of a healthy one");
});

test("a dead service is started and waited for", async () => {
  let spawned = 0;
  const health = await ensureRunning({
    health: upAfter(3),
    spawn: () => { spawned++; },
    sleep: noSleep
  });
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(spawned, 1);
});

test("spawn is called once, however many polls it takes", async () => {
  // A spawn per poll would pile up backends fighting over the same port.
  let spawned = 0;
  await ensureRunning({
    health: upAfter(20),
    spawn: () => { spawned++; },
    sleep: noSleep
  });
  assert.strictEqual(spawned, 1);
});

test("a service that never answers is reported as started, not missing", async () => {
  // "Service not running" would send the user to start something that is
  // already running and failing — the log is where the answer is.
  const health = await ensureRunning({
    health: () => Promise.resolve(DOWN),
    spawn: () => {},
    sleep: noSleep,
    attempts: 3
  });
  assert.strictEqual(health.status, "unreachable");
  assert.strictEqual(health.started, true);
  assert.match(health.error, /did not respond/);
});

test("a failed spawn reports why, not a generic refusal", async () => {
  const health = await ensureRunning({
    health: () => Promise.resolve(DOWN),
    spawn: () => { throw new Error("ENOENT: capset-backend.exe"); },
    sleep: noSleep
  });
  assert.strictEqual(health.started, false);
  assert.match(health.error, /Could not start/);
  assert.match(health.error, /capset-backend\.exe/);
});

test("a spawn that rejects asynchronously is handled too", async () => {
  const health = await ensureRunning({
    health: () => Promise.resolve(DOWN),
    spawn: () => Promise.reject(new Error("no path on record")),
    sleep: noSleep
  });
  assert.strictEqual(health.started, false);
  assert.match(health.error, /no path on record/);
});

test("polling stops at the attempt limit", async () => {
  // An unbounded loop against a service that will never come up would spin
  // for the life of the panel.
  let slept = 0;
  const health = await ensureRunning({
    health: () => Promise.resolve(DOWN),
    spawn: () => {},
    sleep: () => { slept++; return Promise.resolve(); },
    attempts: 5
  });
  assert.strictEqual(health.status, "unreachable");
  assert.ok(slept <= 5, `slept ${slept} times for a 5-attempt limit`);
});

test("the caller is told once that a start is underway", async () => {
  // The panel shows "Starting…" only after a spawn actually happened; saying
  // it when the service was already up would be a lie.
  let notices = 0;
  await ensureRunning({
    health: upAfter(2),
    spawn: () => {},
    sleep: noSleep,
    onStarting: () => { notices++; }
  });
  assert.strictEqual(notices, 1);

  notices = 0;
  await ensureRunning({
    health: () => Promise.resolve(UP),
    spawn: () => {},
    sleep: noSleep,
    onStarting: () => { notices++; }
  });
  assert.strictEqual(notices, 0);
});
