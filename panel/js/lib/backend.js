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

  // Must match TOKEN_HEADER in backend/app/main.py.
  var TOKEN_HEADER = "x-capset-token";

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
    // Proves to the service that we could read its port file. Empty until
    // discovery finds one; the service answers 401 without it.
    this.token = options.token || "";
    this.pollIntervalMs = options.pollIntervalMs || 400;
    // Generous: a long video on CPU is legitimately slow, and killing a job
    // that was going to succeed is worse than waiting.
    this.timeoutMs = options.timeoutMs || 30 * 60 * 1000;
  }

  // What a 401 actually means to someone using the panel.
  //
  // The service refuses /jobs without the token it published in its port
  // file. The panel reads that file at discovery, so a 401 means it could
  // not -- the service wrote the file before this build started publishing a
  // token, or writing it failed, or the file is from an older run. None of
  // that is the user's fault or worth explaining in those terms, and the
  // backend's own message ("missing or wrong x-capset-token") is written for
  // whoever is reading the code, not for whoever is captioning a video.
  var UNAUTHORISED =
    "The transcription service would not accept this request. Restart After " +
    "Effects, or quit the Capset service and click Retry, so the panel can " +
    "pick up its credentials again.";

  CapsetBackend.prototype._url = function (path) {
    return this.baseUrl.replace(/\/+$/, "") + path;
  };

  /** Request options carrying the token, merged over anything given. */
  CapsetBackend.prototype._opts = function (options) {
    var out = {};
    for (var key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) out[key] = options[key];
    }
    out.headers = out.headers || {};
    if (this.token) out.headers[TOKEN_HEADER] = this.token;
    return out;
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

  /**
   * Is the service we are talking to on this machine?
   *
   * Only then can it open a file by path. The default and every discovered
   * port is a loopback address, so this is normally true -- but it is checked
   * rather than assumed, because being wrong means sending the service a path
   * that means something different on its side.
   */
  CapsetBackend.prototype.isLocal = function () {
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(this.baseUrl);
  };

  /**
   * Start a job.
   *
   * `source` is either a Blob to upload or {path: "..."} naming a file the
   * service can open itself. The path is the fast route and the default: it
   * skips reading the audio into the panel, base64-decoding it, building a
   * multipart body and writing the service's own temp copy — four copies of a
   * file that can be hundreds of megabytes. It also cannot corrupt the audio
   * on the way, which the upload route spent four releases proving is a real
   * risk.
   */
  CapsetBackend.prototype.submit = function (source, filename) {
    var self = this;
    var form = new FormData();
    if (source && typeof source.path === "string") {
      if (!this.isLocal()) {
        return Promise.reject(new Error(
          "The transcription service is not on this machine, so it cannot " +
          "read the rendered file directly."
        ));
      }
      form.append("path", source.path);
    } else {
      form.append("file", source, filename || "audio.wav");
    }
    return this._fetch(this._url("/jobs"), this._opts({ method: "POST", body: form }))
      .then(function (res) {
        return res.json().then(function (body) {
          if (res.status === 503) {
            throw new Error(body.detail || "The transcription model is not ready.");
          }
          if (res.status === 401) throw new Error(UNAUTHORISED);
          if (!res.ok) {
            throw new Error(body.detail || "Upload failed: HTTP " + res.status);
          }
          return body;
        });
      });
  };

  CapsetBackend.prototype.job = function (jobId) {
    return this._fetch(this._url("/jobs/" + jobId), this._opts()).then(function (res) {
      if (res.status === 404) throw new Error("Job not found: " + jobId);
      if (res.status === 401) throw new Error(UNAUTHORISED);
      if (!res.ok) throw new Error("Job poll failed: HTTP " + res.status);
      return res.json();
    });
  };

  CapsetBackend.prototype.cancel = function (jobId) {
    return this._fetch(this._url("/jobs/" + jobId), this._opts({ method: "DELETE" }))
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

  CapsetBackend.prototype.transcribe = function (source, filename, onProgress) {
    var self = this;
    return this.submit(source, filename).then(function (job) {
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
