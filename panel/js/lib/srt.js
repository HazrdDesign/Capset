/**
 * SRT / WebVTT subtitle parsing, and SRT writing.
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

  function pad(value, width) {
    var text = String(Math.floor(value));
    while (text.length < width) text = "0" + text;
    return text;
  }

  /**
   * Seconds to an SRT timecode: 00:00:01,500.
   *
   * Milliseconds are ROUNDED, not truncated. After Effects gives times in
   * seconds derived from frames, so 1/30th of a second arrives as
   * 0.03333333333333333 and a truncating formatter turns a caption starting
   * on frame 1 into 00:00:00,033 -- which is correct, and then turns one
   * ending at exactly 2.0 seconds, held as 1.9999999999999998, into
   * 00:00:01,999. Rounding puts both where the frame actually is.
   */
  function toTimecode(seconds) {
    var total = Math.max(0, Number(seconds) || 0);
    var millis = Math.round(total * 1000);
    var hours = Math.floor(millis / 3600000);
    millis -= hours * 3600000;
    var minutes = Math.floor(millis / 60000);
    millis -= minutes * 60000;
    var secs = Math.floor(millis / 1000);
    millis -= secs * 1000;
    return pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(secs, 2) +
           "," + pad(millis, 3);
  }

  /**
   * Render captions as SRT.
   *
   * Cues are numbered from 1 in time order, whatever order they arrive in --
   * layer order in After Effects is not caption order, and a player reading a
   * file whose cues run backwards shows nothing at all.
   *
   * A cue whose end is not after its start is given one millisecond, because
   * a zero-length cue is invalid SRT and dropping it would silently lose a
   * caption the user can see on their timeline.
   *
   * @param {Array} captions {text|lines, start, end} in seconds
   * @returns {string} SRT text, CRLF-terminated as the format specifies
   */
  function format(captions) {
    var list = (captions || []).slice().sort(function (a, b) {
      return (a.start - b.start) || (a.end - b.end);
    });

    var blocks = [];
    for (var i = 0; i < list.length; i++) {
      var caption = list[i];
      var body = caption.lines && caption.lines.length
        ? caption.lines.join("\n")
        : String(caption.text === undefined || caption.text === null
            ? "" : caption.text);
      body = body.replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "");
      if (!body) continue;

      var start = Math.max(0, Number(caption.start) || 0);
      var end = Number(caption.end);
      if (!(end > start)) end = start + 0.001;

      blocks.push(
        (blocks.length + 1) + "\n" +
        toTimecode(start) + " --> " + toTimecode(end) + "\n" +
        body + "\n"
      );
    }

    // CRLF throughout: the SRT convention, and what every editor that ingests
    // one expects. Written last so the logic above stays readable.
    return blocks.join("\n").replace(/\n/g, "\r\n");
  }

  var api = {
    parse: parse,
    format: format,
    toSeconds: toSeconds,
    toTimecode: toTimecode
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetSrt = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
