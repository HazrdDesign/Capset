/**
 * Group word timestamps into caption units.
 *
 * The backend returns a flat, ordered word list and deliberately does no
 * grouping: segmentation is a user preference, not a transcription concern.
 * This module turns that list into captions under several pacing modes and
 * wraps each into display lines. The modes fall into three families:
 *
 *   fixed count  -- one, two, three: exactly N words per caption, no
 *                   judgement. Predictable rhythm, the social-video default.
 *   rhythm       -- phrase, smart, parts: grouped by the pauses in the
 *                   speech, bounded by reading-speed budgets.
 *   sentence     -- whole sentences, split only where the speaker finished
 *                   a thought.
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
    // Smallest caption a pause may produce. 1 keeps the historical
    // behaviour: only the Smart Parts preset raises it.
    minWords: 1,
    // A pause longer than this is a natural caption break.
    maxGapS: 0.6,
    // ...and longer than this is a full stop, which breaks even below
    // minWords. Only the bounded modes set minWords above 1, so this has no
    // effect on the historical ones.
    hardGapS: 1.2,
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
    hardGapS: 0.9,
    maxDurationS: 2.5,
    minDurationS: 0.3
  };

  var SQUARE_DEFAULTS = {
    maxCharsPerLine: 28,
    maxLines: 2,
    maxWords: 7,
    maxGapS: 0.5,
    hardGapS: 1.0,
    maxDurationS: 3.5,
    minDurationS: 0.4
  };

  // Sentences run as long as the speaker's sentences do, so the line budget
  // is generous and only the duration cap really binds.
  var SENTENCE_DEFAULTS = {
    maxCharsPerLine: 42,
    maxLines: 3,
    maxWords: 40,
    minWords: 1,
    maxGapS: 99,
    hardGapS: 99,
    maxDurationS: 8.0,
    minDurationS: 0.5
  };

  // "Smart Parts": grouped by speech rhythm, held to 2-5 words.
  var PARTS_DEFAULTS = {
    maxCharsPerLine: 24,
    maxLines: 2,
    minWords: 2,
    maxWords: 5,
    maxGapS: 0.35,
    hardGapS: 0.7,
    maxDurationS: 2.5,
    minDurationS: 0.3
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

  /**
   * Exactly `size` words per caption.
   *
   * No pause detection, no budget: the point of these modes is a metronomic
   * rhythm the viewer can lock onto, which is why one/two/three-word captions
   * dominate social video. The final caption takes whatever is left over, so
   * a 7-word line at size 3 gives 3 + 3 + 1 rather than dropping the tail.
   */
  function segmentByCount(words, size, options) {
    var opts = merge(PHRASE_DEFAULTS, options);
    var step = Math.max(1, Math.floor(size) || 1);
    var captions = [];
    for (var i = 0; i < words.length; i += step) {
      captions.push(buildCaption(words.slice(i, i + step), opts));
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

        // A floor, so "2 to 5 words" means what it says. Without it a
        // half-second pause after the first word of a phrase emits a
        // one-word caption, and the mode silently degrades into word-by-word
        // on hesitant speech -- exactly the delivery where it happens most.
        //
        // But the floor is not absolute. A real stop -- someone finishing a
        // thought, "Right. ... Anyway" -- must still break, or the first
        // words of the new thought get glued onto the end of the old one,
        // which reads worse than a short caption. hardGapS is where a pause
        // stops being hesitation and starts being punctuation. (ASR
        // punctuation is unreliable, so this cannot be left to SENTENCE_END.)
        var atFloor = current.length >= opts.minWords;
        var realStop = gap > opts.hardGapS;

        if (
          ((atFloor || realStop) && gap > opts.maxGapS) ||
          textLength > budget ||
          current.length >= opts.maxWords ||
          span > opts.maxDurationS
        ) {
          flush();
        }
      }

      current.push(word);
      // Punctuation still wins over the floor: a caption that runs past the
      // end of a sentence to make up its word count reads worse than a short
      // one, and "Right." is a legitimate caption.
      if (SENTENCE_END.test(word.text)) flush();
    }
    flush();
    return captions;
  }

  /**
   * One caption per sentence.
   *
   * Splits only where the speaker finished a thought, ignoring the character
   * and word budgets that bound the rhythm modes -- a sentence that needs
   * three lines gets three lines. wrapLines still breaks it for display, so
   * "ignore the budget" means "do not CUT here", not "do not wrap".
   *
   * The duration cap is the one budget kept. ASR punctuation is imperfect and
   * a speaker who never lands a full stop would otherwise produce a single
   * caption spanning the whole clip -- unreadable, and worse than a slightly
   * early break.
   */
  function segmentBySentence(words, options) {
    var opts = merge(SENTENCE_DEFAULTS, options);
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
      if (current.length &&
          word.end - current[0].start > opts.maxDurationS) {
        flush();
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
   * @param {object} config
   *   mode: "one"|"two"|"three"  exactly N words per caption
   *         "parts"              2-5 words, grouped on pauses
   *         "sentence"           one sentence per caption
   *         "smart"              phrase pacing sized to the comp shape
   *         "phrase"             broadcast pacing (the default)
   *         "word"               historical alias for "one"
   *   width, height: comp dimensions, used by "smart" only
   *   options: overrides merged over the mode's defaults
   */
  // Fixed-count modes, by name. "word" is the historical spelling of "one"
  // and is kept so presets saved by earlier versions still resolve.
  var COUNT_MODES = { word: 1, one: 1, two: 2, three: 3 };

  function segment(words, config) {
    var list = words || [];
    var cfg = config || {};
    var mode = cfg.mode || "phrase";

    if (Object.prototype.hasOwnProperty.call(COUNT_MODES, mode)) {
      return {
        mode: mode,
        layout: null,
        captions: segmentByCount(list, COUNT_MODES[mode], cfg.options)
      };
    }
    if (mode === "parts") {
      return {
        mode: mode,
        layout: null,
        captions: segmentByPhrase(list, merge(PARTS_DEFAULTS, cfg.options))
      };
    }
    if (mode === "sentence") {
      return {
        mode: mode,
        layout: null,
        captions: segmentBySentence(list, cfg.options)
      };
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
    SENTENCE_DEFAULTS: SENTENCE_DEFAULTS,
    PARTS_DEFAULTS: PARTS_DEFAULTS,
    COUNT_MODES: COUNT_MODES,
    chooseLayout: chooseLayout,
    wrapLines: wrapLines,
    segmentByCount: segmentByCount,
    segmentByPhrase: segmentByPhrase,
    segmentBySentence: segmentBySentence,
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
