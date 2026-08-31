/**
 * Client for the local transcription service.
 *
 * Transcription is a submitted job, so this polls. `fetch` and `sleep` are
 * injectable so the polling logic can be tested without a server or real
 * elapsed time.
 */
(function (root) {
  "use strict";

  var DEFAULT_BASE = "http://127.0.0.1:8756";

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

  var api = { CapsetBackend: CapsetBackend, DEFAULT_BASE: DEFAULT_BASE };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetBackendLib = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
