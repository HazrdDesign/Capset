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

// --- port discovery ---------------------------------------------------------
//
// The backend falls back to a free port when 8756 is taken -- most often by a
// Capset backend left over from a previous After Effects session -- and
// publishes the port it landed on. Before this the panel only ever asked
// 8756, so a service running perfectly well on 49871 read as "not running".

/** A fetch that answers only for the given port, refusing every other. */
function onlyPort(port, body) {
  const seen = [];
  const fn = async (url) => {
    seen.push(url);
    if (url.indexOf(":" + port + "/") === -1) throw new Error("ECONNREFUSED");
    return { ok: true, status: 200, json: async () => body };
  };
  fn.seen = seen;
  return fn;
}

test("connect uses the published port when the default is dead", async () => {
  const fetch = onlyPort(49871, { status: "ok", model_loaded: true });
  const b = new CapsetBackend({ fetch });
  const health = await b.connect([49871]);
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(b.baseUrl, "http://127.0.0.1:49871");
});

test("connect prefers the published port over the default", async () => {
  // Both answer. The published one is authoritative: the default may be held
  // by a stale process that would accept requests and never finish a job.
  const fetch = async (url) => ({
    ok: true, status: 200, json: async () => ({ status: "ok", url })
  });
  const b = new CapsetBackend({ fetch });
  await b.connect([49871]);
  assert.strictEqual(b.baseUrl, "http://127.0.0.1:49871");
});

test("connect falls back to the default when no port was published", async () => {
  const fetch = onlyPort(8756, { status: "ok", model_loaded: true });
  const b = new CapsetBackend({ fetch });
  const health = await b.connect([]);
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(b.baseUrl, "http://127.0.0.1:8756");
});

test("connect tries the default after a stale published port", async () => {
  // The port file outlives the process that wrote it, so a stale port is the
  // expected case after a crash or a reboot.
  const fetch = onlyPort(8756, { status: "ok", model_loaded: true });
  const b = new CapsetBackend({ fetch });
  const health = await b.connect([49871]);
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(b.baseUrl, "http://127.0.0.1:8756");
});

test("connect reports unreachable and leaves baseUrl on the default", async () => {
  // Leaving baseUrl on a dead discovered port would make the retry button
  // useless once the user actually starts the service. Holds because the
  // default is always the last candidate tried, which this pins.
  const b = new CapsetBackend({
    fetch: async () => { throw new Error("ECONNREFUSED"); }
  });
  const health = await b.connect([49871]);
  assert.strictEqual(health.status, "unreachable");
  assert.strictEqual(b.baseUrl, "http://127.0.0.1:8756");
});

test("connect does not probe the same port twice", async () => {
  // The repeated port must be DEAD, or a non-deduplicating implementation
  // stops on the first success and passes without deduplicating anything.
  const fetch = onlyPort(9999, { status: "ok" });
  const b = new CapsetBackend({ fetch });
  await b.connect([8756, 8756]);
  assert.deepStrictEqual(fetch.seen, ["http://127.0.0.1:8756/health"]);
});

test("connect ignores a malformed published port", async () => {
  const fetch = onlyPort(8756, { status: "ok" });
  const b = new CapsetBackend({ fetch });
  await b.connect([null, "", "not-a-port", 0]);
  assert.deepStrictEqual(fetch.seen, ["http://127.0.0.1:8756/health"]);
});


// --- handing over the audio -------------------------------------------------

/** stub() drops the request body; this keeps it so the form can be inspected. */
function bodyCapturingStub(responses) {
  const bodies = [];
  const queue = responses.slice();
  const fn = async (url, init) => {
    bodies.push(init && init.body);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  fn.bodies = bodies;
  return fn;
}

test("a local path is sent as a path, not uploaded", async () => {
  const fetch = bodyCapturingStub([{ status: 202, body: { id: "j1", state: "queued" } }]);
  const b = new CapsetBackend({ fetch, sleep: noSleep });
  await b.submit({ path: "C:\\Temp\\capset_1.wav" });

  const form = fetch.bodies[0];
  assert.strictEqual(form.get("path"), "C:\\Temp\\capset_1.wav");
  assert.strictEqual(form.get("file"), null, "the file was uploaded as well");
});

test("a blob is still uploaded", async () => {
  const fetch = bodyCapturingStub([{ status: 202, body: { id: "j1", state: "queued" } }]);
  const b = new CapsetBackend({ fetch, sleep: noSleep });
  await b.submit(new Blob([new Uint8Array([1, 2, 3])]), "take.wav");

  const form = fetch.bodies[0];
  assert.strictEqual(form.get("path"), null);
  assert.ok(form.get("file"), "no file part in the upload");
});

test("loopback is recognised, anything else is not", () => {
  const local = ["http://127.0.0.1:8756", "http://localhost:9000", "http://[::1]:8756"];
  const remote = ["http://10.0.0.9:8756", "http://example.com", "http://127.0.0.1.evil.com"];
  local.forEach((u) =>
    assert.ok(new CapsetBackend({ baseUrl: u }).isLocal(), u + " should be local"));
  remote.forEach((u) =>
    assert.ok(!new CapsetBackend({ baseUrl: u }).isLocal(), u + " should NOT be local"));
});

test("a path is refused when the service is not on this machine", async () => {
  // The path would name a file on the panel's machine and mean something
  // else — or nothing — on the service's. Better to say so than to transcribe
  // whatever happens to be at that path over there.
  const b = new CapsetBackend({
    baseUrl: "http://10.0.0.9:8756",
    fetch: bodyCapturingStub([{ status: 202, body: { id: "j1" } }]),
    sleep: noSleep,
  });
  await assert.rejects(() => b.submit({ path: "/tmp/a.wav" }), /not on this machine/);
});


// --- the token -------------------------------------------------------------
//
// The service refuses /jobs without it. A web page on this machine can reach
// the service -- loopback does not distinguish a browser from the panel --
// but cannot read the port file the token is published in.

test("the token rides on every /jobs request", async () => {
  const seen = [];
  const backend = new CapsetBackend({
    token: "tok-123",
    fetch: (url, opts) => {
      seen.push([url, (opts && opts.headers && opts.headers["x-capset-token"]) || null]);
      return Promise.resolve({
        ok: true, status: 202,
        json: () => Promise.resolve({ id: "j1", state: "done", result: { words: [] } })
      });
    }
  });
  await backend.submit({ path: "/tmp/a.wav" }, "a.wav");
  await backend.job("j1");
  await backend.cancel("j1");
  assert.ok(seen.length >= 3, "expected submit, poll and cancel");
  seen.forEach(([url, tok]) =>
    assert.strictEqual(tok, "tok-123", "no token on " + url));
});

test("no token means no header, not the string undefined", () => {
  // An older backend publishes a port file with no token in it. Sending
  // "undefined" would be refused with a confusing message; sending nothing
  // gets the honest 401.
  const backend = new CapsetBackend({ token: "" });
  const opts = backend._opts({ method: "POST" });
  assert.ok(!("x-capset-token" in opts.headers), JSON.stringify(opts.headers));
  assert.strictEqual(opts.method, "POST");
});

test("the header name matches the backend's", () => {
  const py = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "backend", "app", "main.py"),
    "utf8");
  const declared = py.match(/TOKEN_HEADER\s*=\s*"([^"]+)"/);
  assert.ok(declared, "the backend no longer declares TOKEN_HEADER");
  const opts = new CapsetBackend({ token: "x" })._opts();
  assert.ok(declared[1] in opts.headers,
    "panel sends " + Object.keys(opts.headers) + ", backend wants " + declared[1]);
});

test("a refused request says what to do, not what the header is called", () => {
  // Before the token existed a missing port file just meant the default port
  // was used and everything worked. Now it means 401 on every job, so the
  // message has to be one a person can act on.
  const backend = new CapsetBackend({
    fetch: () => Promise.resolve({
      ok: false, status: 401,
      json: () => Promise.resolve({ detail: "missing or wrong x-capset-token" })
    })
  });
  return backend.submit({ path: "/tmp/a.wav" }, "a.wav").then(
    () => assert.fail("a 401 should reject"),
    (err) => {
      assert.match(err.message, /Restart After Effects/);
      assert.ok(!/x-capset-token/.test(err.message), err.message);
    }
  );
});

test("a refused poll says the same thing", () => {
  const backend = new CapsetBackend({
    fetch: () => Promise.resolve({ ok: false, status: 401,
      json: () => Promise.resolve({}) })
  });
  return backend.job("j1").then(
    () => assert.fail("a 401 should reject"),
    (err) => assert.match(err.message, /Restart After Effects/)
  );
});
