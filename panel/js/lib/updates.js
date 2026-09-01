/**
 * Update checking.
 *
 * Fetches a small JSON manifest, compares it against the running version,
 * and reports whether something newer exists. It deliberately does NOT
 * install anything — see the note on distribution below.
 *
 * Manifest shape:
 *   {
 *     "version": "0.2.0",
 *     "url": "https://hazrd.gumroad.com/l/capset",
 *     "notes": "What changed",
 *     "minimum": "0.1.0"        // optional: below this, updating is required
 *   }
 *
 * WHY IT LINKS RATHER THAN DOWNLOADS: Capset is sold, so the installer is
 * not at a public URL — Gumroad issues per-buyer links. The manifest can
 * therefore only point at the buyer's library page, not a file. A future
 * version could download and launch the installer directly (one UAC prompt),
 * but that needs a distribution host that can authenticate buyers.
 *
 * Pure and dependency-free: runs in the CEP panel and under node for tests.
 */
(function (root) {
  "use strict";

  // Check at most once a day. A plugin that phones home on every panel open
  // is obnoxious and, on a flaky network, slows down opening the panel.
  var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  var STORAGE_KEY = "capset.lastUpdateCheck";

  /**
   * Compare dotted numeric versions.
   *
   * Numeric per segment, not lexicographic: "0.1.10" is NEWER than "0.1.9",
   * which string comparison gets backwards. Trailing segments are treated as
   * zero, so "1.2" and "1.2.0" are equal. A pre-release suffix ("1.0.0-beta")
   * sorts before the release it precedes.
   *
   * @returns -1 if a < b, 0 if equal, 1 if a > b
   */
  function compareVersions(a, b) {
    function split(v) {
      var text = String(v == null ? "" : v).trim().replace(/^v/i, "");
      var parts = text.split("-");
      var nums = parts[0].split(".").map(function (n) {
        var parsed = parseInt(n, 10);
        return isNaN(parsed) ? 0 : parsed;
      });
      return { nums: nums, pre: parts.length > 1 ? parts.slice(1).join("-") : null };
    }

    var left = split(a);
    var right = split(b);
    var length = Math.max(left.nums.length, right.nums.length);

    for (var i = 0; i < length; i++) {
      var l = left.nums[i] === undefined ? 0 : left.nums[i];
      var r = right.nums[i] === undefined ? 0 : right.nums[i];
      if (l !== r) return l < r ? -1 : 1;
    }

    // Same numbers: a pre-release is older than the plain release.
    if (left.pre && !right.pre) return -1;
    if (!left.pre && right.pre) return 1;
    if (left.pre && right.pre && left.pre !== right.pre) {
      return left.pre < right.pre ? -1 : 1;
    }
    return 0;
  }

  function isNewer(candidate, current) {
    return compareVersions(candidate, current) > 0;
  }

  function UpdateChecker(options) {
    options = options || {};
    this.manifestUrl = options.manifestUrl || null;
    this.currentVersion = options.currentVersion || "0.0.0";
    this._fetch = options.fetch || (typeof fetch !== "undefined" ? fetch.bind(null) : null);
    this._now = options.now || function () { return Date.now(); };
    this._storage = options.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    this.intervalMs = options.intervalMs === undefined ? CHECK_INTERVAL_MS : options.intervalMs;
  }

  UpdateChecker.prototype._lastCheck = function () {
    if (!this._storage) return 0;
    try {
      return parseInt(this._storage.getItem(STORAGE_KEY), 10) || 0;
    } catch (e) {
      return 0;   // private mode, blocked storage: just check again
    }
  };

  UpdateChecker.prototype._recordCheck = function () {
    if (!this._storage) return;
    try {
      this._storage.setItem(STORAGE_KEY, String(this._now()));
    } catch (e) {}
  };

  UpdateChecker.prototype.isDue = function () {
    return this._now() - this._lastCheck() >= this.intervalMs;
  };

  /**
   * @param {boolean} force check even if one ran recently
   * @returns {Promise<{status, version?, url?, notes?, required?, reason?}>}
   *          status is "update" | "current" | "skipped" | "unavailable"
   */
  UpdateChecker.prototype.check = function (force) {
    var self = this;

    if (!this.manifestUrl) {
      return Promise.resolve({ status: "unavailable", reason: "No update URL configured." });
    }
    if (!force && !this.isDue()) {
      return Promise.resolve({ status: "skipped", reason: "Checked recently." });
    }

    return this._fetch(this.manifestUrl, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (manifest) {
        self._recordCheck();
        if (!manifest || !manifest.version) {
          return { status: "unavailable", reason: "Malformed update manifest." };
        }
        if (!isNewer(manifest.version, self.currentVersion)) {
          return { status: "current", version: self.currentVersion };
        }
        return {
          status: "update",
          version: manifest.version,
          url: manifest.url || null,
          notes: manifest.notes || "",
          // A minimum above the running version means this build is no longer
          // supported — e.g. a backend API change that broke compatibility.
          required: !!(manifest.minimum &&
                       compareVersions(self.currentVersion, manifest.minimum) < 0)
        };
      })
      .catch(function (err) {
        // Never surface a failed update check as an error. Being offline is
        // normal and must not look like the plugin is broken.
        return {
          status: "unavailable",
          reason: String(err && err.message ? err.message : err)
        };
      });
  };

  var api = {
    UpdateChecker: UpdateChecker,
    compareVersions: compareVersions,
    isNewer: isNewer,
    CHECK_INTERVAL_MS: CHECK_INTERVAL_MS,
    STORAGE_KEY: STORAGE_KEY
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetUpdates = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
