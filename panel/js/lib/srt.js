/**
 * SRT / WebVTT subtitle parsing.
 *
 * Lets people bring timings from elsewhere instead of transcribing: a
 * corrected transcript, another tool's output, or a translation. Output
 * matches the backend's caption shape so everything downstream — animation
 * timing, layer building — is identical either way.
 *
 * Pure and dependency-free: runs in the CEP panel and under node for tests.
 */
(function (root) {
  "use strict";

  // 00:00:01,500 or 00:00:01.500 — SRT uses a comma, VTT a dot. Hours are
  // optional in VTT, so accept both shapes.
  var TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  var CUE = new RegExp(
    TIME.source + "\\s*-->\\s*" + TIME.source,
    ""
  );

  function toSeconds(hours, minutes, seconds, millis) {
    return (
      (parseInt(hours || "0", 10) * 3600) +
      (parseInt(minutes, 10) * 60) +
      parseInt(seconds, 10) +
      // "5" means 500ms, "50" means 500ms, "500" means 500ms.
      (parseInt(millis, 10) / Math.pow(10, String(millis).length)) * 1
    );
  }

  /**
   * @param {string} text raw .srt or .vtt contents
   * @returns {{captions: Array, errors: Array}} captions are
   *          {text, start, end, lines}
   */
  function parse(text) {
    var captions = [];
    var errors = [];
    if (!text) return { captions: captions, errors: errors };

    // Strip a BOM, normalise line endings, drop the WEBVTT header.
    var normalized = String(text)
      .replace(/^﻿/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/^WEBVTT[^\n]*\n/, "");

    var blocks = normalized.split(/\n{2,}/);

    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b].replace(/^\n+|\n+$/g, "");
      if (!block) continue;

      var lines = block.split("\n");
      var timeIndex = -1;
      var match = null;
      for (var l = 0; l < lines.length; l++) {
        var found = lines[l].match(CUE);
        if (found) { timeIndex = l; match = found; break; }
      }
      if (!match) {
        errors.push("Block " + (b + 1) + " has no timecode line; skipped.");
        continue;
      }

      var start = toSeconds(match[1], match[2], match[3], match[4]);
      var end = toSeconds(match[5], match[6], match[7], match[8]);
      if (!(end > start)) {
        errors.push("Block " + (b + 1) + " ends before it starts; skipped.");
        continue;
      }

      var bodyLines = lines.slice(timeIndex + 1);
      var body = [];
      for (var i = 0; i < bodyLines.length; i++) {
        // Drop inline tags (<i>, <c.classname>) rather than rendering them
        // literally into the caption.
        var cleaned = bodyLines[i].replace(/<[^>]*>/g, "").replace(/^\s+|\s+$/g, "");
        if (cleaned) body.push(cleaned);
      }
      if (!body.length) {
        errors.push("Block " + (b + 1) + " has a timecode but no text; skipped.");
        continue;
      }

      captions.push({
        text: body.join(" "),
        start: start,
        end: end,
        lines: body,
        words: []
      });
    }

    captions.sort(function (a, b) { return a.start - b.start; });
    return { captions: captions, errors: errors };
  }

  var api = { parse: parse, toSeconds: toSeconds };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetSrt = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
