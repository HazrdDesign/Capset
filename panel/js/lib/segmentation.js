/**
 * Group word timestamps into caption units.
 *
 * The backend returns a flat, ordered word list and deliberately does no
 * grouping: segmentation is a user preference, not a transcription concern.
 * This module turns that list into captions under three modes -- word,
 * phrase, and smart -- and wraps each into display lines.
 *
 * Phrase defaults follow professional subtitling practice (Netflix: 42
 * characters per line, 2 lines, ~20 characters/second reading speed) rather
 * than being invented. Social/vertical work wants something much punchier,
 * which is what `smart` detects.
 *
 * Pure and dependency-free: runs in the CEP panel and under node for tests.
 */
(function (root) {
  "use strict";

  // Netflix-style broadcast defaults.
  var PHRASE_DEFAULTS = {
    maxCharsPerLine: 42,
    maxLines: 2,
    maxWords: 14,
    // A pause longer than this is a natural caption break.
    maxGapS: 0.6,
    maxDurationS: 6.0,
    // Below this a caption flashes; extend it if the next word allows.
    minDurationS: 0.5
  };

  // Vertical/social: fewer words, larger type, faster cuts.
  var VERTICAL_DEFAULTS = {
    maxCharsPerLine: 20,
    maxLines: 2,
    maxWords: 4,
    maxGapS: 0.45,
    maxDurationS: 2.5,
    minDurationS: 0.3
  };

  var SQUARE_DEFAULTS = {
    maxCharsPerLine: 28,
    maxLines: 2,
    maxWords: 7,
    maxGapS: 0.5,
    maxDurationS: 3.5,
    minDurationS: 0.4
  };

  var SENTENCE_END = /[.!?]["')\]]?$/;

  function assign(target, source) {
    if (!source) return target;
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
      }
    }
    return target;
  }

  function merge(base, overrides) {
    return assign(assign({}, base), overrides);
  }

  /**
   * Pick a layout from the comp's dimensions.
   *
   * Aspect ratio is a better signal than resolution: a 1080x1920 vertical and
   * a 1920x1080 horizontal have identical pixel counts but want completely
   * different caption shapes.
   */
  function chooseLayout(width, height) {
    var w = Number(width) || 0;
    var h = Number(height) || 0;
    if (w <= 0 || h <= 0) {
      return {
        orientation: "unknown",
        aspect: 0,
        options: merge(PHRASE_DEFAULTS, null),
        rationale: "Comp size unavailable; using broadcast defaults."
      };
    }

    var aspect = w / h;
    if (aspect < 0.9) {
      return {
        orientation: "vertical",
        aspect: aspect,
        options: merge(VERTICAL_DEFAULTS, null),
        rationale:
          "Vertical comp (" + w + "x" + h + "). Short captions and large " +
          "type read better on phones."
      };
    }
    if (aspect <= 1.2) {
      return {
        orientation: "square",
        aspect: aspect,
        options: merge(SQUARE_DEFAULTS, null),
        rationale: "Square-ish comp (" + w + "x" + h + "). Medium captions."
      };
    }
    return {
      orientation: "horizontal",
      aspect: aspect,
      options: merge(PHRASE_DEFAULTS, null),
      rationale:
        "Horizontal comp (" + w + "x" + h + "). Broadcast-style captions " +
        "(42 chars/line, 2 lines)."
    };
  }

  /** Greedy word wrap. Returns at most `maxLines` lines. */
  function wrapLines(text, maxCharsPerLine, maxLines) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [];
    var current = "";

    for (var i = 0; i < words.length; i++) {
      var candidate = current ? current + " " + words[i] : words[i];
      if (current && candidate.length > maxCharsPerLine) {
        lines.push(current);
        current = words[i];
        // Everything left goes on the final line rather than being dropped.
        if (lines.length === maxLines - 1) {
          current = words.slice(i).join(" ");
          break;
        }
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  function buildCaption(words, options) {
    var text = words.map(function (w) { return w.text; }).join(" ");
    return {
      text: text,
      start: words[0].start,
      end: words[words.length - 1].end,
      words: words.slice(),
      lines: wrapLines(text, options.maxCharsPerLine, options.maxLines)
    };
  }

  /** One caption per word. */
  function segmentByWord(words, options) {
    var opts = merge(PHRASE_DEFAULTS, options);
    var captions = [];
    for (var i = 0; i < words.length; i++) {
      captions.push(buildCaption([words[i]], opts));
    }
    return captions;
  }

  /**
   * Group words into phrase captions.
   *
   * A caption is closed when adding the next word would exceed the character
   * or word budget, when the pause before it is long enough to be a natural
   * break, when the caption has run too long, or after sentence-ending
   * punctuation.
   */
  function segmentByPhrase(words, options) {
    var opts = merge(PHRASE_DEFAULTS, options);
    var budget = opts.maxCharsPerLine * opts.maxLines;
    var captions = [];
    var current = [];

    function flush() {
      if (current.length) {
        captions.push(buildCaption(current, opts));
        current = [];
      }
    }

    for (var i = 0; i < words.length; i++) {
      var word = words[i];

      if (current.length) {
        var previous = current[current.length - 1];
        var gap = word.start - previous.end;
        var textLength = current.reduce(function (n, w) {
          return n + w.text.length + 1;
        }, 0) + word.text.length;
        var span = word.end - current[0].start;

        if (
          gap > opts.maxGapS ||
          textLength > budget ||
          current.length >= opts.maxWords ||
          span > opts.maxDurationS
        ) {
          flush();
        }
      }

      current.push(word);
      if (SENTENCE_END.test(word.text)) flush();
    }
    flush();
    return captions;
  }

  /** Choose a mode from the comp's shape, then segment. */
  function segmentSmart(words, width, height, options) {
    var layout = chooseLayout(width, height);
    var opts = merge(layout.options, options);
    return {
      layout: layout,
      captions: segmentByPhrase(words, opts)
    };
  }

  /**
   * Entry point.
   *
   * @param {Array} words backend word list ({text, start, end, confidence})
   * @param {object} config {mode: "word"|"phrase"|"smart", width, height, options}
   */
  function segment(words, config) {
    var list = words || [];
    var cfg = config || {};
    var mode = cfg.mode || "phrase";

    if (mode === "word") {
      return { mode: mode, layout: null, captions: segmentByWord(list, cfg.options) };
    }
    if (mode === "smart") {
      var smart = segmentSmart(list, cfg.width, cfg.height, cfg.options);
      return { mode: mode, layout: smart.layout, captions: smart.captions };
    }
    return { mode: "phrase", layout: null, captions: segmentByPhrase(list, cfg.options) };
  }

  /** Characters per second -- over ~20 is uncomfortably fast to read. */
  function readingSpeed(caption) {
    var duration = caption.end - caption.start;
    if (duration <= 0) return Infinity;
    return caption.text.length / duration;
  }

  var api = {
    PHRASE_DEFAULTS: PHRASE_DEFAULTS,
    VERTICAL_DEFAULTS: VERTICAL_DEFAULTS,
    SQUARE_DEFAULTS: SQUARE_DEFAULTS,
    chooseLayout: chooseLayout,
    wrapLines: wrapLines,
    segmentByWord: segmentByWord,
    segmentByPhrase: segmentByPhrase,
    segmentSmart: segmentSmart,
    segment: segment,
    readingSpeed: readingSpeed
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetSegmentation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
