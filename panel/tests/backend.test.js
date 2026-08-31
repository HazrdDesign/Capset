const test = require("node:test");
const assert = require("node:assert");
const { CapsetBackend } = require("../js/lib/backend.js");

function stub(responses) {
  const calls = [];
  const queue = responses.slice();
  const fn = async (url, init) => {
    calls.push({ url, method: (init && init.method) || "GET" });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body
    };
  };
  fn.calls = calls;
  return fn;
}

const noSleep = () => Promise.resolve();

test("health returns the parsed body", async () => {
  const b = new CapsetBackend({
    fetch: stub([{ status: 200, body: { status: "ok", model_loaded: true } }])
  });
  assert.deepStrictEqual(await b.health(), { status: "ok", model_loaded: true });
});

test("an unreachable backend reports a state, not a thrown error", async () => {
  // Connection refused is the normal "not started yet" case; the panel needs
  // to render a message, not crash.
  const b = new CapsetBackend({
    fetch: async () => { throw new Error("ECONNREFUSED"); }
  });
  const health = await b.health();
  assert.strictEqual(health.status, "unreachable");
  assert.strictEqual(health.model_loaded, false);
  assert.match(health.error, /ECONNREFUSED/);
});

test("waitFor polls until done and returns the result", async () => {
  const b = new CapsetBackend({
    sleep: noSleep,
    fetch: stub([
      { status: 200, body: { state: "running", progress: 0.2, stage: "a" } },
      { status: 200, body: { state: "running", progress: 0.7, stage: "b" } },
      { status: 200, body: { state: "done", progress: 1, result: { words: [1, 2] } } }
    ])
  });
  const result = await b.waitFor("job1");
  assert.deepStrictEqual(result, { words: [1, 2] });
});

test("waitFor reports progress for every poll", async () => {
  const seen = [];
  const b = new CapsetBackend({
    sleep: noSleep,
    fetch: stub([
      { status: 200, body: { state: "running", progress: 0.25, stage: "x" } },
      { status: 200, body: { state: "done", progress: 1, result: {} } }
    ])
  });
  await b.waitFor("job1", (p) => seen.push(p));
  assert.deepStrictEqual(seen, [0.25, 1]);
});

test("a failed job surfaces the backend's message", async () => {
  const b = new CapsetBackend({
    sleep: noSleep,
    fetch: stub([{ status: 200, body: { state: "error", error: "ffmpeg exploded" } }])
  });
  await assert.rejects(() => b.waitFor("job1"), /ffmpeg exploded/);
});

test("a cancelled job rejects clearly", async () => {
  const b = new CapsetBackend({
    sleep: noSleep,
    fetch: stub([{ status: 200, body: { state: "cancelled" } }])
  });
  await assert.rejects(() => b.waitFor("job1"), /cancelled/i);
});

test("waitFor gives up rather than polling forever", async () => {
  const b = new CapsetBackend({
    sleep: noSleep,
    timeoutMs: -1,
    fetch: stub([{ status: 200, body: { state: "running", progress: 0.1 } }])
  });
  await assert.rejects(() => b.waitFor("job1"), /timed out/i);
});

test("a 503 on submit explains that the model is not ready", async () => {
  const b = new CapsetBackend({
    fetch: stub([{ status: 503, body: { detail: "onnx-asr is not installed" } }])
  });
  await assert.rejects(() => b.submit(new Blob(["x"]), "a.wav"), /onnx-asr/);
});

test("an unknown job id rejects", async () => {
  const b = new CapsetBackend({
    fetch: stub([{ status: 404, body: { detail: "no such job" } }])
  });
  await assert.rejects(() => b.job("nope"), /not found/i);
});

test("base url is normalised so paths never double-slash", async () => {
  const f = stub([{ status: 200, body: {} }]);
  const b = new CapsetBackend({ baseUrl: "http://127.0.0.1:8756/", fetch: f });
  await b.health();
  assert.strictEqual(f.calls[0].url, "http://127.0.0.1:8756/health");
});

test("cancel issues a DELETE", async () => {
  const f = stub([{ status: 202, body: { cancelled: true } }]);
  const b = new CapsetBackend({ fetch: f });
  await b.cancel("job1");
  assert.strictEqual(f.calls[0].method, "DELETE");
});
