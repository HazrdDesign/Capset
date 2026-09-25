/**
 * The Proofread tab's logic: timecode, problem flags, and every edit it makes.
 *
 * The tab lists the captions on the timeline and lets them be retyped and
 * retimed by hand. Everything that decides WHAT an edit is lives here, where
 * it runs under node; the host script only applies edits it is handed, the
 * same split as js/lib/srt.js and capsetCaptionsForExport.
 *
 * A row is one caption as capsetProofreadList returns it:
 *   {ref, text, start, end}  -- text with "\n" line breaks, times in seconds
 *                               in the timeline the user is looking at
 * A comp is {frameRate, frameDuration, dropFrame, displayStartTime, duration}.
 *
 * An edit is {ref, expect, text?, start?, end?, shiftBy?}. `expect` is the
 * row as it was read, and the host refuses the edit if the layer no longer
 * matches it -- so a caption changed by hand in After Effects, or by an undo,
 * is never overwritten by a list that has gone stale.
 *
 * Pure and dependency-free: runs in the CEP panel and under node for tests.
 */
(function (root) {
  "use strict";

  // --- thresholds ------------------------------------------------------------
  //
  // What counts as a problem. Named, because each is a judgement call someone
  // will want to revisit, and a bare number in the middle of findIssues would
  // not say which.

  // A gap this many frames or shorter between two captions reads as a blink:
  // the screen empties for an instant and refills. Closed gaps and gaps long
  // enough to register as a pause are both fine.
  var FLICKER_FRAMES = 2;

  // On screen for less than this and a caption is gone before it is read.
  // Low on purpose: word-by-word captions are legitimately brief, and a flag
  // on every one of them would teach people to ignore the flag.
  var MIN_DURATION = 0.2;

  // Characters per second, spaces included, the way broadcast subtitle
  // guidelines count them. Above this, most viewers cannot finish the line.
  var MAX_CPS = 20;

  // --- timecode ------------------------------------------------------------

  function frameDuration(comp) {
    return comp.frameDuration || 1 / (comp.frameRate || 30);
  }

  /** Whole frames per timecode second: 30 for 29.97, 24 for 23.976. */
  function timebase(comp) {
    return Math.round(comp.frameRate || 1 / frameDuration(comp));
  }

  /**
   * Drop-frame applies only where After Effects applies it: a comp set to
   * drop-frame at 29.97 or 59.94. Anywhere else the flag means nothing.
   */
  function dropsFrames(comp) {
    var base = timebase(comp);
    return !!comp.dropFrame && (base === 30 || base === 60) &&
      Math.abs(comp.frameRate - base) > 0.001;
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  /** Snap seconds onto the nearest frame. */
  function snap(seconds, comp) {
    var fd = frameDuration(comp);
    return Math.round(seconds / fd) * fd;
  }

  /** Frames counted from zero on the displayed timecode. */
  function toFrames(seconds, comp) {
    return Math.round((seconds + (comp.displayStartTime || 0)) / frameDuration(comp));
  }

  function fromFrames(frames, comp) {
    return frames * frameDuration(comp) - (comp.displayStartTime || 0);
  }

  /**
   * Seconds on the timeline to the timecode After Effects shows for them:
   * HH:MM:SS:FF, or HH;MM;SS;FF in a drop-frame comp.
   *
   * Includes the comp's display start time, so a comp that starts at
   * 01:00:00:00 reads the same here as in its own timeline.
   */
  function formatTimecode(seconds, comp) {
    var frames = Math.max(0, toFrames(seconds, comp));
    var base = timebase(comp);
    var sep = ":";

    if (dropsFrames(comp)) {
      // SMPTE drop-frame: frame NUMBERS 0 and 1 (0-3 at 59.94) are skipped at
      // the start of every minute except each tenth. No frames are dropped,
      // only labels, which is why the count has to be converted rather than
      // simply divided.
      var drop = base === 60 ? 4 : 2;
      var perTen = Math.round((comp.frameRate || base) * 600);
      var perMinute = base * 60 - drop;
      var tens = Math.floor(frames / perTen);
      var rest = frames % perTen;
      frames += drop * 9 * tens;
      if (rest > drop) frames += drop * Math.floor((rest - drop) / perMinute);
      sep = ";";
    }

    var ff = frames % base;
    var totalSeconds = Math.floor(frames / base);
    return pad2(Math.floor(totalSeconds / 3600)) + sep +
           pad2(Math.floor(totalSeconds / 60) % 60) + sep +
           pad2(totalSeconds % 60) + sep +
           pad2(ff);
  }

  /**
   * What someone typed into a timecode field, as seconds on the timeline.
   *
   * Accepts what After Effects' own timecode fields accept, so nothing new
   * has to be learned:
   *   00:00:04:12   full timecode (";" also accepted)
   *   4:12          the leading fields may be left off
   *   412           digits only, read from the right: 4 seconds 12 frames
   * plus two shortcuts that After Effects does not have:
   *   +3 / -2       nudge by frames from `current`
   *   4.5s          seconds
   *
   * Overflowing fields carry, as they do in After Effects: 0:45 at 30 fps is
   * 1 second 15 frames.
   *
   * @returns {{seconds: number}|{error: string}}
   */
  function parseTimecode(text, comp, current) {
    var value = String(text === undefined || text === null ? "" : text)
      .replace(/^\s+|\s+$/g, "");
    if (!value) return { error: "Type a timecode, like 00:00:04:12." };

    var fd = frameDuration(comp);
    var nudge = value.match(/^([+-])\s*(\d+)$/);
    if (nudge) {
      if (typeof current !== "number") return { error: "Nothing to nudge from." };
      var by = parseInt(nudge[2], 10) * (nudge[1] === "-" ? -1 : 1);
      return checkStart(snap(current + by * fd, comp));
    }

    var secs = value.match(/^(\d+(?:\.\d+)?|\.\d+)\s*s$/i);
    if (secs) return checkStart(snap(parseFloat(secs[1]) - (comp.displayStartTime || 0), comp));

    var parts;
    if (/^\d+$/.test(value)) {
      // Digits only: pairs from the right, as After Effects reads them.
      parts = [];
      for (var end = value.length; end > 0; end -= 2) {
        parts.unshift(value.slice(Math.max(0, end - 2), end));
      }
    } else if (/^\d+(?:[:;.]\d+){1,3}$/.test(value)) {
      parts = value.split(/[:;.]/);
    } else {
      return { error: "\"" + value + "\" is not a timecode. Use 00:00:04:12." };
    }
    if (parts.length > 4) return { error: "\"" + value + "\" has too many digits." };
    while (parts.length < 4) parts.unshift("0");

    var hh = parseInt(parts[0], 10);
    var mm = parseInt(parts[1], 10);
    var ss = parseInt(parts[2], 10);
    var ff = parseInt(parts[3], 10);
    var base = timebase(comp);
    var frames = ((hh * 60 + mm) * 60 + ss) * base + ff;

    if (dropsFrames(comp)) {
      // Undo the skipped labels: two per minute (four at 59.94), except
      // every tenth minute.
      var drop = base === 60 ? 4 : 2;
      var minutes = hh * 60 + mm;
      frames -= drop * (minutes - Math.floor(minutes / 10));
    }
    return checkStart(fromFrames(frames, comp));
  }

  function checkStart(seconds) {
    // A hair of tolerance: displayStartTime and frame arithmetic in floating
    // point can land a timecode that is exactly zero a femtosecond below it.
    if (seconds < -1e-6) return { error: "That is before the composition starts." };
    return { seconds: Math.max(0, seconds) };
  }

  /** A duration as "1.25s": short, and not mistakable for a timecode. */
  function formatDuration(seconds) {
    return (Math.max(0, seconds) || 0).toFixed(2) + "s";
  }

  // --- rows and edits ------------------------------------------------------

  /** The state an edit expects to find, so the host can refuse a stale one. */
  function expectOf(row) {
    return { text: row.text, start: row.start, end: row.end };
  }

  function edit(row, changes) {
    var out = { ref: row.ref, expect: expectOf(row) };
    for (var key in changes) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) out[key] = changes[key];
    }
    return out;
  }

  /** Normalise typed caption text: one kind of line break, no stray edges. */
  function cleanText(text) {
    return String(text === undefined || text === null ? "" : text)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/^\s+|\s+$/g, "");
  }

  /**
   * A retyped caption, as an edit. Null when nothing changed.
   * @returns {{edit}|{error}|null}
   */
  function retext(row, typed) {
    var text = cleanText(typed);
    // Compared cleaned on both sides: a layer typed in After Effects can hold
    // a space before its line break, and leaving the field untouched must not
    // count as an edit just because the panel would have tidied it.
    if (text === cleanText(row.text)) return null;
    if (!text) {
      return { error: "A caption cannot be empty. Merge it into its neighbour instead." };
    }
    return { edit: edit(row, { text: text }) };
  }

  /**
   * One edge of a caption moved to `seconds`, as an edit. Null when nothing
   * changed. The caption must keep at least one frame, and must not start
   * before the composition does.
   * @returns {{edit}|{error}|null}
   */
  function retime(row, which, seconds, comp) {
    var fd = frameDuration(comp);
    var t = snap(seconds, comp);
    var start = which === "start" ? t : row.start;
    var end = which === "end" ? t : row.end;
    if (Math.abs(t - row[which]) < fd / 2) return null;
    if (start < -1e-6) return { error: "A caption cannot start before the composition." };
    if (end - start < fd / 2) {
      return {
        error: which === "start"
          ? "That is after the caption ends (" + formatTimecode(row.end, comp) + ")."
          : "That is before the caption starts (" + formatTimecode(row.start, comp) + ")."
      };
    }
    var change = {};
    change[which] = t;
    return { edit: edit(row, change) };
  }

  // --- problem flags -------------------------------------------------------

  function words(text) {
    var found = String(text).split(/\s+/);
    var n = 0;
    for (var i = 0; i < found.length; i++) if (found[i]) n++;
    return n;
  }

  /**
   * Problems per row, in the same order as `rows`. Rows must be in time order,
   * which is how capsetProofreadList returns them.
   *
   * @returns {Array<Array<{kind: string, message: string}>>}
   */
  function findIssues(rows, comp) {
    var fd = frameDuration(comp);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var next = rows[i + 1];
      var issues = [];
      var duration = row.end - row.start;

      if (next) {
        var gapFrames = Math.round((next.start - row.end) / fd);
        if (gapFrames < 0) {
          issues.push({
            kind: "overlap",
            message: "Overlaps the next caption by " + plural(-gapFrames, "frame") +
                     ": both are on screen at once."
          });
        } else if (gapFrames > 0 && gapFrames <= FLICKER_FRAMES) {
          issues.push({
            kind: "flicker",
            message: "A " + plural(gapFrames, "frame") + " gap before the next " +
                     "caption: the screen blinks empty between them."
          });
        }
      }

      if (duration < MIN_DURATION - fd / 2) {
        issues.push({
          kind: "short",
          message: "On screen for " + formatDuration(duration) + ": gone before it can be read."
        });
      }

      var chars = row.text.replace(/\n/g, " ").length;
      if (words(row.text) > 1 && duration > 0 && chars / duration > MAX_CPS) {
        issues.push({
          kind: "fast",
          message: Math.round(chars / duration) + " characters per second: " +
                   "too fast to read (aim for " + MAX_CPS + " or fewer)."
        });
      }
      out.push(issues);
    }
    return out;
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  /**
   * Edits that remove every overlap and blink.
   *
   * Both are fixed by moving the earlier caption's OUT point to where the next
   * one starts: an overlap is pulled back, a blink is closed. The next
   * caption's in point is left alone because it is the one tied to the speech
   * -- it is when the words start.
   *
   * A caption the next one starts on top of cannot be fixed this way without
   * vanishing, so it is left as it is and reported in `unfixed`.
   *
   * @returns {{edits: Array, unfixed: Array<number>}}
   */
  function fixOverlaps(rows, comp) {
    var fd = frameDuration(comp);
    var flags = findIssues(rows, comp);
    var edits = [];
    var unfixed = [];
    for (var i = 0; i < rows.length - 1; i++) {
      var kinds = flags[i].map(function (f) { return f.kind; });
      if (kinds.indexOf("overlap") === -1 && kinds.indexOf("flicker") === -1) continue;
      var target = snap(rows[i + 1].start, comp);
      if (target - rows[i].start < fd / 2) {
        unfixed.push(i);
        continue;
      }
      edits.push(edit(rows[i], { end: target }));
    }
    return { edits: edits, unfixed: unfixed };
  }

  // --- time shift ----------------------------------------------------------

  /**
   * Move captions `from` onward (all of them, from 0) by whole frames.
   *
   * A shift moves the layer rather than trimming it, so anything keyframed on
   * a caption travels with it.
   *
   * @returns {{edits: Array}|{error: string}}
   */
  function shift(rows, from, frames, comp) {
    var n = Math.round(Number(frames));
    if (!n) return { error: "Enter how many frames to shift by." };
    var start = Math.max(0, from || 0);
    if (start >= rows.length) return { error: "No captions to shift." };
    var by = n * frameDuration(comp);

    var earliest = rows[start].start;
    for (var i = start; i < rows.length; i++) {
      if (rows[i].start < earliest) earliest = rows[i].start;
    }
    if (earliest + by < -1e-6) {
      return {
        error: "That would move " + (start ? "a caption" : "the first caption") +
               " before the composition starts. The most it can move earlier is " +
               plural(Math.round(earliest / frameDuration(comp)), "frame") + "."
      };
    }

    var edits = [];
    for (var j = start; j < rows.length; j++) edits.push(edit(rows[j], { shiftBy: by }));
    return { edits: edits };
  }

  // --- find and replace ----------------------------------------------------

  /**
   * Where `query` occurs in `text`, as [index] into `text`.
   *
   * A line break counts as a space, so "see you" finds a caption that breaks
   * between the two words -- which is how it reads on screen.
   */
  function occurrences(text, query, matchCase) {
    if (!query) return [];
    var hay = String(text).replace(/\n/g, " ");
    var needle = String(query);
    if (!matchCase) {
      hay = hay.toLowerCase();
      needle = needle.toLowerCase();
    }
    var found = [];
    var at = hay.indexOf(needle);
    while (at !== -1) {
      found.push(at);
      at = hay.indexOf(needle, at + needle.length);
    }
    return found;
  }

  /** Indices of the rows whose text contains `query`. */
  function find(rows, query, matchCase) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (occurrences(rows[i].text, query, matchCase).length) out.push(i);
    }
    return out;
  }

  /**
   * Replace every occurrence of `query`, as edits. Plain text, not a pattern:
   * the people using this are fixing a name the transcriber misheard, and a
   * stray "." should not match everything.
   *
   * Refused outright if any caption would be left empty, rather than leaving
   * an invisible layer behind or quietly skipping it.
   *
   * @returns {{edits: Array, count: number}|{error: string}}
   */
  function replaceAll(rows, query, replacement, matchCase) {
    if (!query) return { error: "Type something to find first." };
    var edits = [];
    var count = 0;
    var emptied = 0;
    for (var i = 0; i < rows.length; i++) {
      var text = rows[i].text;
      var hits = occurrences(text, query, matchCase);
      if (!hits.length) continue;
      var out = "";
      var last = 0;
      for (var h = 0; h < hits.length; h++) {
        out += text.slice(last, hits[h]) + replacement;
        last = hits[h] + query.length;
      }
      out = cleanText(out + text.slice(last)).replace(/ {2,}/g, " ");
      count += hits.length;
      if (!out) { emptied++; continue; }
      if (out !== text) edits.push(edit(rows[i], { text: out }));
    }
    if (emptied) {
      return {
        error: "That would leave " + plural(emptied, "caption") + " empty. " +
               "Merge or delete those first."
      };
    }
    return { edits: edits, count: count };
  }

  // --- split and merge -----------------------------------------------------

  /**
   * Split a caption where the text cursor is.
   *
   * The time is placed in proportion to the text on either side, which is
   * where the break roughly falls in the speech -- there are no word timings
   * on a layer to do better with -- and snapped to a frame. It is a starting
   * point: the new timecodes are right there to adjust.
   *
   * @returns {{first, second}|{error: string}} each {text, start, end}
   */
  function splitAt(row, at, comp) {
    var fd = frameDuration(comp);
    var text = String(row.text);
    var left = cleanText(text.slice(0, at));
    var right = cleanText(text.slice(at));
    if (!left || !right) {
      return { error: "Put the text cursor between the words where it should split." };
    }
    if (row.end - row.start < 2 * fd - fd / 2) {
      return { error: "That caption is one frame long, too short to split." };
    }
    var share = left.length / (left.length + right.length);
    var t = snap(row.start + (row.end - row.start) * share, comp);
    if (t < row.start + fd) t = snap(row.start + fd, comp);
    if (t > row.end - fd) t = snap(row.end - fd, comp);
    return {
      first: { text: left, start: row.start, end: t },
      second: { text: right, start: t, end: row.end }
    };
  }

  /**
   * Two captions as one: the first's text then the second's, spanning both.
   * @returns {{text, start, end}}
   */
  function merge(a, b) {
    return {
      text: cleanText(cleanText(a.text) + " " + cleanText(b.text)),
      start: Math.min(a.start, b.start),
      end: Math.max(a.end, b.end)
    };
  }

  var api = {
    FLICKER_FRAMES: FLICKER_FRAMES,
    MIN_DURATION: MIN_DURATION,
    MAX_CPS: MAX_CPS,
    snap: snap,
    formatTimecode: formatTimecode,
    parseTimecode: parseTimecode,
    formatDuration: formatDuration,
    cleanText: cleanText,
    expectOf: expectOf,
    retext: retext,
    retime: retime,
    findIssues: findIssues,
    fixOverlaps: fixOverlaps,
    shift: shift,
    occurrences: occurrences,
    find: find,
    replaceAll: replaceAll,
    splitAt: splitAt,
    merge: merge
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetProofread = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
