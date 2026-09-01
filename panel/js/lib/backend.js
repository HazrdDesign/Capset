/**
 * Client for the local transcription service.
 *
 * Transcription is a submitted job, so this polls. `fetch` and `sleep` are
 * injectable so the polling logic can be tested without a server or real
 * elapsed time.
 */
(function (root) {
  "use strict";

  var DEFAULT_PORT = 8756;
  var DEFAULT_BASE = "http://127.0.0.1:" + DEFAULT_PORT;

  function baseForPort(port) {
    return "http://127.0.0.1:" + port;
  }

  function CapsetBackend(options) {
    options = options || {};
    this.baseUrl = options.baseUrl || DEFAULT_BASE;
    this._fetch = options.fetch || (typeof fetch !== "undefined" ? fetch.bind(null) : null);
    this._sleep = options.sleep || function (ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
    };
    this.pollIntervalMs = options.pollIntervalMs || 400;
    // Generous: a long video on CPU is legitimately slow, and killing a job
    // that was going to succeed is worse than waiting.
    this.timeoutMs = options.timeoutMs || 30 * 60 * 1000;
  }

  CapsetBackend.prototype._url = function (path) {
    return this.baseUrl.replace(/\/+$/, "") + path;
  };

  CapsetBackend.prototype.health = function () {
    var self = this;
    return this._fetch(this._url("/health"))
      .then(function (res) {
        if (!res.ok) throw new Error("health check failed: HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        // A refused connection is the normal "backend not started yet"
        // state, not an exception worth surfacing raw to the user.
        return {
          status: "unreachable",
          model_loaded: false,
          error: String(err && err.message ? err.message : err),
          baseUrl: self.baseUrl
        };
      });
  };

  /**
   * Point at whichever port the service actually bound to.
   *
   * `ports` is tried in order and the first one whose /health answers wins;
   * baseUrl is left alone if none do, so the failure the user sees is the
   * ordinary "service not running" rather than a silent wrong-port stall.
   *
   * The backend falls back to a free port when its preferred one is taken
   * and publishes the result to a file (see _publish_port in the backend).
   * Without this the fallback would be useless: the panel would keep asking
   * 8756 and conclude the service was down while it was serving happily
   * somewhere else.
   */
  CapsetBackend.prototype.connect = function (ports) {
    var self = this;
    var candidates = [];
    var seen = {};
    for (var i = 0; i < (ports || []).length; i++) {
      var port = parseInt(ports[i], 10);
      if (!port || seen[port]) continue;
      seen[port] = true;
      candidates.push(port);
    }
    if (!seen[DEFAULT_PORT]) candidates.push(DEFAULT_PORT);

    var index = 0;
    var lastResult = null;

    function attempt() {
      if (index >= candidates.length) {
        // Nothing answered. baseUrl is left on the default rather than on a
        // stale discovered port, because the default is always tried last —
        // so the retry button asks the port the service will most likely
        // come up on.
        return Promise.resolve(lastResult);
      }
      self.baseUrl = baseForPort(candidates[index++]);
      return self.health().then(function (health) {
        lastResult = health;
        if (health.status === "unreachable") return attempt();
        return health;
      });
    }
    return attempt();
  };

  CapsetBackend.prototype.submit = function (file, filename) {
    var self = this;
    var form = new FormData();
    form.append("file", file, filename || "audio.wav");
    return this._fetch(this._url("/jobs"), { method: "POST", body: form })
      .then(function (res) {
        return res.json().then(function (body) {
          if (res.status === 503) {
            throw new Error(body.detail || "The transcription model is not ready.");
          }
          if (!res.ok) {
            throw new Error(body.detail || "Upload failed: HTTP " + res.status);
          }
          return body;
        });
      });
  };

  CapsetBackend.prototype.job = function (jobId) {
    return this._fetch(this._url("/jobs/" + jobId)).then(function (res) {
      if (res.status === 404) throw new Error("Job not found: " + jobId);
      if (!res.ok) throw new Error("Job poll failed: HTTP " + res.status);
      return res.json();
    });
  };

  CapsetBackend.prototype.cancel = function (jobId) {
    return this._fetch(this._url("/jobs/" + jobId), { method: "DELETE" })
      .then(function (res) { return res.json(); });
  };

  /** Poll until terminal. `onProgress(progress, stage)` is optional. */
  CapsetBackend.prototype.waitFor = function (jobId, onProgress) {
    var self = this;
    var started = Date.now();

    function step() {
      return self.job(jobId).then(function (job) {
        if (onProgress) onProgress(job.progress || 0, job.stage || job.state);

        if (job.state === "done") return job.result;
        if (job.state === "error") throw new Error(job.error || "Transcription failed.");
        if (job.state === "cancelled") throw new Error("Transcription cancelled.");

        if (Date.now() - started > self.timeoutMs) {
          throw new Error("Transcription timed out.");
        }
        return self._sleep(self.pollIntervalMs).then(step);
      });
    }
    return step();
  };

  CapsetBackend.prototype.transcribe = function (file, filename, onProgress) {
    var self = this;
    return this.submit(file, filename).then(function (job) {
      return self.waitFor(job.id, onProgress);
    });
  };

  var api = {
    CapsetBackend: CapsetBackend,
    DEFAULT_BASE: DEFAULT_BASE,
    DEFAULT_PORT: DEFAULT_PORT
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetBackendLib = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
