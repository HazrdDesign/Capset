/**
 * Bring the transcription service up on demand.
 *
 * The installer starts the backend once, at the end of setup. After that the
 * first reboot leaves it dead, and the panel's only recourse was a message
 * telling the user to go and start it themselves — which is exactly the kind
 * of friction the plugin exists to remove, and indistinguishable from a
 * broken install.
 *
 * Launching on demand rather than at login is deliberate: the service holds
 * the speech model in memory, so a login-time autostart would cost several
 * hundred megabytes on every boot whether or not After Effects is ever
 * opened. Starting it when the panel opens costs nothing the rest of the
 * time.
 *
 * Everything the host provides — spawning, reading files, sleeping — is
 * injected, so the retry logic is testable under node without CEP.
 */
(function (root) {
  "use strict";

  // Generous: a frozen Python binary unpacks itself into a temp directory on
  // first run, which on a cold disk with an antivirus watching is slow. The
  // model no longer loads before the port opens, so this is waiting on
  // process start, not on a download.
  var DEFAULT_ATTEMPTS = 40;
  var DEFAULT_INTERVAL_MS = 500;

  function reachable(health) {
    return !!health && health.status !== "unreachable";
  }

  /**
   * Return a health result, starting the service first if it is not running.
   *
   * `spawn` is called at most once. Resolving it does not mean the service is
   * up — only that the process was created — so the port is polled afterwards.
   */
  function ensureRunning(options) {
    var health = options.health;
    var spawn = options.spawn;
    var sleep = options.sleep || function (ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
    };
    var attempts = options.attempts || DEFAULT_ATTEMPTS;
    var intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    var onStarting = options.onStarting || function () {};

    return health().then(function (first) {
      if (reachable(first)) return first;

      var launched;
      try {
        launched = Promise.resolve(spawn());
      } catch (err) {
        launched = Promise.reject(err);
      }

      return launched.then(
        function () {
          onStarting();
          var tries = 0;
          function poll() {
            if (tries++ >= attempts) {
              // Started but never answered. Say so rather than repeating
              // "not running", which would send the user to start a service
              // that is already running and failing.
              return health().then(function (last) {
                if (reachable(last)) return last;
                return {
                  status: "unreachable",
                  model_loaded: false,
                  started: true,
                  error: "The transcription service was started but did not " +
                         "respond. See the Capset log for details."
                };
              });
            }
            return sleep(intervalMs).then(health).then(function (next) {
              return reachable(next) ? next : poll();
            });
          }
          return poll();
        },
        function (err) {
          // Could not launch at all — a missing or moved executable. The
          // original unreachable result is the wrong message here.
          return {
            status: "unreachable",
            model_loaded: false,
            started: false,
            error: "Could not start the transcription service: " +
                   String(err && err.message ? err.message : err)
          };
        }
      );
    });
  }

  var api = {
    ensureRunning: ensureRunning,
    DEFAULT_ATTEMPTS: DEFAULT_ATTEMPTS,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetLauncher = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
