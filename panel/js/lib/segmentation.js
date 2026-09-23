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
    //
    // Was 0.6 until the backend started reporting gaps honestly (see
    // align.py): a real ~0.6s silence sat right on that boundary, and
    // "greater than", not "at least", meant it did not clear it. 0.5 leaves
    // the same margin below a genuine pause that 0.6 always had above a
    // breath -- the 0.35s breaths bestCut's own reasoning below depends on
    // staying under this are still comfortably under 0.5.
    maxGapS: 0.5,
    // ...and longer than this is a full stop, which breaks even below
    // minWords. Only the bounded modes set minWords above 1, so this has no
    // effect on the historical ones.
    hardGapS: 1.2,
    maxDurationS: 6.0
  };

  // Vertical/social: fewer words, larger type, faster cuts.
  var VERTICAL_DEFAULTS = {
    maxCharsPerLine: 20,
    maxLines: 2,
    maxWords: 4,
    maxGapS: 0.45,
    hardGapS: 0.9,
    maxDurationS: 2.5
  };

  var SQUARE_DEFAULTS = {
    maxCharsPerLine: 28,
    maxLines: 2,
    maxWords: 7,
    maxGapS: 0.5,
    hardGapS: 1.0,
    maxDurationS: 3.5
  };

  // Sentences run as long as the speaker's sentences do, so the line budget
  // is generous and only the duration cap really binds.
  var SENTENCE_DEFAULTS = {
    maxCharsPerLine: 42,
    maxLines: 3,
    maxWords: 40,
    // A sentence cut by the duration cap is cut by arithmetic, exactly like a
    // phrase cut by the word budget, and strands a word the same way: the
    // reported case ended "...and supports" / "me." rebalance() needs a floor
    // above 1 to have anything to enforce.
    minWords: 2,
    maxGapS: 99,
    hardGapS: 99,
    maxDurationS: 8.0
  };

  // "Smart Parts": grouped by speech rhythm, held to 2-5 words.
  var PARTS_DEFAULTS = {
    maxCharsPerLine: 24,
    maxLines: 2,
    minWords: 2,
    maxWords: 5,
    maxGapS: 0.35,
    hardGapS: 0.7,
    maxDurationS: 2.5
  };

  var SENTENCE_END = /[.!?]["')\]]?$/;

  // A clause ending: the comma in "...as a person, holds me with value".
  //
  // Not a sentence, so it never CLOSES a caption on its own -- one that
  // stopped at every comma would be shorter than it needs to be. But when a
  // caption has to end somewhere anyway, this is the best place in reach: it
  // is where the writing already breaks, so the cut reads as a decision
  // rather than as running out of room.
  //
  // A trailing hyphen is deliberately absent. It marks a word cut off
  // mid-utterance ("holds me with-"), which is the opposite of a boundary.
  var CLAUSE_END = /[,;:]["')\]]?$/;

  // The longest silence a caption is held across.
  //
  // Where to CUT and whether to BLANK THE SCREEN are different questions, and
  // tying the second to the first was wrong. A 0.5s pause is a good place to
  // end a caption -- it is how the speaker phrased the line -- and a terrible
  // place to show nothing, because at that length the screen just flickers.
  // Reading each mode's maxGapS as both left Smart blanking four times in a
  // twenty-second clip, twice in the middle of a sentence.
  //
  // So the caption simply stays up until the next one arrives, and this is
  // the one thing that stops it: longer than any ordinary pause between
  // phrases or sentences, shorter than a beat a speaker takes on purpose.
  // Past it they have genuinely stopped and the captions stop with them --
  // without that, a caption sits on screen through a silence, which is the
  // "word held for six seconds" bug in ARCHITECTURE.md.
  var MAX_HOLD_S = 1.2;



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
   * Hold a caption that would otherwise blink -- and never move its start.
   *
   * A caption goes on screen the instant its first word is spoken, and
   * nothing here changes that. Sync between the type and the voice is the
   * point; buying reading time by starting a caption early breaks it against
   * the one reference the viewer has, which is the audio.
   *
   * The END is another matter. Left exactly on the last word, two things go
   * wrong that have nothing to do with the speech:
   *
   *   - a caption the budget cut mid-breath clears a frame or two before the
   *     next one arrives, and the screen blinks between them;
   *   - a caption holding one short word -- "Wait." at 0.18s -- is gone
   *     before it can be read.
   *
   * One rule answers both, and only ever by holding a caption longer: it
   * runs on for MAX_HOLD_S past its last word, or until the next caption
   * starts, whichever comes first. Speech that keeps going gives the next
   * caption inside that window, so the screen never blanks between them; a
   * silence longer than it clears the screen, because by then the speaker
   * really has stopped.
   *
   * Being one rule matters. As two -- bridge a hole under the threshold,
   * otherwise hold to a minimum -- the behaviour jumped at the boundary: a
   * 1.20s pause played continuous and a 1.21s pause blanked for nearly a
   * second. Written this way the blank grows from nothing as the silence
   * does, which is what it looks like it should do.
   */
  function hold(captions) {
    for (var i = 0; i < captions.length; i++) {
      var next = captions[i + 1];
      // Never into the caption after it: where the recogniser hands back
      // overlapping words, which it does at chunk boundaries, this pulls the
      // end BACK. Two caption layers lit at once is worse than one a few
      // frames short. It cannot invert a caption -- words arrive ordered by
      // start, so the next caption never begins before this one does.
      captions[i].end = Math.min(
        captions[i].end + MAX_HOLD_S,
        next ? next.start : Infinity
      );
    }
    return captions;
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
    return hold(captions);
  }

  /** Length of these words once joined with single spaces. */
  function joinedLength(words) {
    var n = 0;
    for (var i = 0; i < words.length; i++) n += words[i].text.length;
    return n + Math.max(0, words.length - 1);
  }

  /** Seconds from the first word's start to the last word's end. */
  function spanOf(words) {
    return words[words.length - 1].end - words[0].start;
  }

  /**
   * How far this caption may run, and whether it stopped because it wanted to.
   *
   * Three things end a run. Two are the speaker's -- a pause long enough to
   * break on, and a sentence ending -- and land exactly where they fall. The
   * third is the budget, which lands wherever the arithmetic runs out, and
   * that is a position with no meaning at all. `byBudget` says which, because
   * only the third is worth moving.
   */
  function reach(words, start, opts) {
    var budget = opts.maxCharsPerLine * opts.maxLines;
    var length = words[start].text.length;
    var end = start + 1;

    if (SENTENCE_END.test(words[start].text)) {
      return { end: end, byBudget: false };
    }

    while (end < words.length) {
      var word = words[end];
      var gap = word.start - words[end - 1].end;
      var count = end - start;

      // A floor, so a half-second pause after the first word of a phrase
      // cannot emit a one-word caption and degrade the mode into word-by-word
      // on hesitant speech. Not absolute: a stop long enough to be
      // punctuation breaks anyway, or the start of a new thought gets glued
      // to the end of the old one.
      if ((count >= opts.minWords || gap > opts.hardGapS) && gap > opts.maxGapS) {
        return { end: end, byBudget: false };
      }

      if (length + 1 + word.text.length > budget ||
          count >= opts.maxWords ||
          word.end - words[start].start > opts.maxDurationS) {
        return { end: end, byBudget: true };
      }

      length += 1 + word.text.length;
      end++;
      if (SENTENCE_END.test(word.text)) {
        return { end: end, byBudget: false };
      }
    }
    return { end: end, byBudget: false };
  }

  /**
   * Where to cut a caption the budget closed.
   *
   * This is the reported bug. On a 16:9 comp a caption fills up at fourteen
   * words, and fourteen words is not a place -- it is a number. The line
   *
   *   "Going into my career, I think it's more important for me to find the"
   *   "place that really finds me and chooses me as a person, holds me with"
   *
   * is cut twice in the middle of a phrase, and the speaker had paused in
   * neither spot. They paused after "for me to" and after "as a person," --
   * 0.35s each, real breaths, plainly audible, and both ignored because they
   * are under the 0.5s that counts as a pause worth CUTTING on.
   *
   * Those two thresholds are doing different jobs. maxGapS asks "is this
   * break so clear the caption should end here even though it has room
   * left?" -- a high bar, correctly. This asks a much easier question: the
   * caption has to end somewhere in the next few words, so which of them is
   * least bad? A 0.35s breath is an obvious answer to the second and an
   * obvious no to the first.
   *
   * So: the largest gap in the back half of the window. The back half because
   * the budget is what put us here -- a break three words in would throw away
   * line space the caption is entitled to, and a half-empty caption is its
   * own kind of wrong.
   *
   * What it looks for is not silence. It used to be, and on this material
   * there is no silence to find: the reported clip is a voice over a music
   * bed, the gap between every pair of words measures exactly zero, energy
   * detection cannot see the word boundaries through the music, and Silero
   * reports the whole clip as one unbroken span of speech. A rule that waits
   * for quiet never fires on the work this is for.
   *
   * What is visible, whatever plays underneath, is how long the speaker
   * spends on a word -- see heldFor. When nothing in the window runs long,
   * the cut stays where the budget put it: in speech with no holds in it
   * there is nothing better, and inventing one would only make captions
   * shorter for no reason.
   */
  // How much longer than its own normal length a word must run to read as a
  // hold. 1.4 is deliberately short of the 1.5 measured on the reported line,
  // so that line is inside the rule rather than exactly on its edge.
  var HELD_RATIO = 1.4;

  // A word broken off mid-utterance -- "holds me with-". The speaker was
  // interrupted, which is the opposite of a boundary, and such a word is
  // often stretched, so it scores well on exactly the measure below unless
  // it is excluded outright.
  var FRAGMENT = /-$/;

  function bareWord(text) {
    return String(text).toLowerCase().replace(/[^a-z']/g, "");
  }

  /**
   * How long each word normally takes THIS speaker, in THIS recording.
   *
   * The measurement that settled it. Asking whether a word ran long needs
   * something to call normal, and every text-based guess at that was wrong:
   * by characters "find" outranked "to" because it has two more letters, and
   * by syllables they tied, because both are one. Neither can know that /tu/
   * is half the length of /faInd/.
   *
   * A speaker who says a word twice has answered the question themselves. In
   * the reported line, "to" ran 0.250s where the same speaker's other two
   * "to"s ran 0.167s -- 1.50x -- while "find" ran 1.25x its own other
   * instance. The hold is on "to", which is what was reported from listening
   * to it, and no phonetics were needed to see it.
   *
   * The shortest instance is the baseline: it is the one least likely to have
   * been stretched.
   *
   * A word said only once scores nothing at all, and that is the point. The
   * first version estimated a baseline for those from syllables and word
   * class, and the estimate is not in the same units as the measurement: it
   * put "for" -- said once -- at 2.94x against a guessed 0.085s, beating the
   * 1.50x that "to" genuinely measured against its own 0.167s. A guess and a
   * measurement cannot be ranked against each other. Where the speaker has
   * not shown us their own normal for a word, we do not know, and the honest
   * score for "do not know" is zero.
   */
  function baselinesFor(words) {
    var seen = {};
    for (var i = 0; i < words.length - 1; i++) {
      var key = bareWord(words[i].text);
      if (!key) continue;
      var span = words[i + 1].start - words[i].start;
      if (!(key in seen) || span < seen[key]) seen[key] = span;
    }
    // A word said once needs no filtering out: it is its own shortest
    // instance, so it scores exactly 1.0 and can never reach HELD_RATIO.
    // "Do not know" and "not held" come to the same answer here.
    return seen;
  }

  /**
   * How far past its own normal length this word runs.
   *
   * Critically, this never looks for silence. On the material this is for --
   * a voice over a music bed, which is what the reported clip is -- there is
   * no silence to find: the music fills every gap, energy detection cannot
   * see the word boundaries, and Silero reports the whole clip as one
   * unbroken span of speech. A rule that waits for quiet never fires. The
   * time the speaker spends on a word is visible whatever is playing
   * underneath it.
   */
  function heldFor(words, i, baselines) {
    if (i + 1 >= words.length) return 0;
    if (FRAGMENT.test(words[i].text)) return 0;
    var span = words[i + 1].start - words[i].start;
    var key = bareWord(words[i].text);
    var normal = baselines[key];
    if (normal === undefined || normal <= 0) return 0;
    return span / normal;
  }

  /**
   * A second reported case, on material heldFor cannot help with: a real
   * word IS an ASR token, with a genuine gap either side, but that gap gets
   * under-measured. Parakeet reports only where a token starts (see
   * onnx_asr_engine._MAX_TOKEN_S); align.py pulls a word's boundaries onto
   * the audio's own silence when it can, but it needs a run of silence
   * clearly separated from the clip's speech level to trust, and a chunk
   * boundary, a soft consonant, or simply align.py being switched off can
   * still leave a pause measuring far short of how long it really was. A
   * ~0.6s silence came through as ~0.28s -- comfortably under maxGapS in
   * every mode, so reach() read it as a within-phrase breath and glued the
   * first word of a new thought onto the end of the old one.
   *
   * The 0.28s itself is not the evidence. What is, is that it stands out
   * against how this caption otherwise flows: a run of ~0.05s gaps with one
   * outlier several times as wide is a real speaker's pause, however small
   * the number came out; a run where every gap is close to that size is
   * just an unhurried speaker, and moving the cut there would chop their
   * line for no reason -- see "a gap that does not stand out" below.
   *
   * GAP_ABS_FLOOR keeps a merely-slower-than-usual word from qualifying on
   * its own: it must be an outlier AND a real amount of time, not just a
   * ratio, which a window of near-zero gaps would satisfy for almost
   * anything. GAP_MEDIAN_MULT is deliberately looser than HELD_RATIO's 1.4
   * -- an actual silence, even a short one, is rarer and more legible than a
   * stretched word, so it can be trusted further from the ordinary case.
   */
  var GAP_ABS_FLOOR = 0.25;
  var GAP_MEDIAN_MULT = 2.5;

  /** The silence between word `i` and word `i + 1`, floored at zero. */
  function gapAt(words, i) {
    return Math.max(0, words[i + 1].start - words[i].end);
  }

  /**
   * This caption's own typical gap, so a pause can be judged against how
   * THIS speaker and THIS window actually sound rather than a fixed number.
   *
   * The median, not the mean: one real pause in an otherwise tight run would
   * drag a mean up toward itself and make the very outlier being searched
   * for look ordinary by comparison. On the reported clip's music-bed
   * material every gap is exactly zero, so the median is zero and
   * GAP_ABS_FLOOR alone decides -- which is what keeps this a no-op there,
   * matching heldFor's own reasoning for why that clip needs a different
   * signal entirely.
   */
  function medianGap(words, start, limit) {
    var gaps = [];
    for (var i = start; i < limit - 1; i++) gaps.push(gapAt(words, i));
    if (!gaps.length) return 0;
    gaps.sort(function (a, b) { return a - b; });
    var mid = Math.floor(gaps.length / 2);
    return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  }

  function bestCut(words, start, limit, opts, baselines) {
    var floor = Math.max(1, opts.minWords || 1);
    var earliest = Math.max(start + floor,
                            start + Math.ceil((limit - start) / 2));
    if (earliest > limit) return limit;

    // Punctuation first, and the LAST of it: both the strongest boundary
    // available and the one that fills the line. The speaker's own comma
    // beats any measurement we could make of the gaps around it, because it
    // is where the sentence itself breaks -- see "a comma outranks a pause"
    // below, which pins this ordering down: even a gap wide enough to
    // qualify next does not move the cut off a comma already in reach.
    for (var p = limit; p >= earliest; p--) {
      if (CLAUSE_END.test(words[p - 1].text)) return p;
    }

    // A measured pause that stands out from this caption's own rhythm,
    // next -- see the comment on gapAt/medianGap above. Still confined to
    // the back half: a pause three words into a fourteen-word window is the
    // same "throw away line space the caption is entitled to" problem a
    // stretched word or a comma there would be, not a stronger claim just
    // because it happened to leave a gap -- see "a breath early in the
    // window" below.
    var typical = medianGap(words, start, limit);
    var gapCut = -1;
    var bestGap = GAP_ABS_FLOOR;
    for (var g = earliest; g <= limit; g++) {
      var gap = gapAt(words, g - 1);
      if (gap >= GAP_ABS_FLOOR && gap >= GAP_MEDIAN_MULT * typical && gap >= bestGap) {
        bestGap = gap;
        gapCut = g;
      }
    }
    if (gapCut !== -1) return gapCut;

    var at = limit;
    // Must be beaten, not matched, to move the cut off the budget's position.
    var best = HELD_RATIO;
    for (var c = earliest; c <= limit; c++) {
      var held = heldFor(words, c - 1, baselines);
      // >= so that when two holds are equally long the later one wins and the
      // caption is as full as it can be.
      if (held >= best) { best = held; at = c; }
    }
    return at;
  }

  /**
   * Group words into phrase-sized runs, cutting where the speech does.
   */
  function groupByPhrase(words, opts) {
    var groups = [];
    var baselines = baselinesFor(words);
    var start = 0;
    while (start < words.length) {
      var run = reach(words, start, opts);
      var end = run.byBudget
        ? bestCut(words, start, run.end, opts, baselines)
        : run.end;
      groups.push(words.slice(start, end));
      start = end;
    }
    return groups;
  }

  /**
   * Move cuts that stranded a word, rather than leaving them where the
   * arithmetic put them.
   *
   * A run closes the moment one more word will not fit, so whatever is left
   * over becomes the next caption however little it is. Five evenly-spoken
   * words against a four-word budget gave "I really enjoyed making" and then
   * "this." on a layer of its own -- with nothing in the delivery cutting
   * there. It reads as a mistake because it is one: that break landed on a
   * word count, not on anything the speaker did.
   *
   * So the break is MOVED, not removed: words come back off the end of the
   * caption before until the tail reaches the floor, giving "I really
   * enjoyed" and "making this." -- both within budget, and cut where a
   * person would cut. When the caption before has nothing to spare the short
   * one stands, because the budget that forced the cut forbids undoing it
   * just as much as it forbids ignoring it.
   *
   * Two cuts are never moved, because they are the speaker's rather than the
   * budget's: a pause long enough to break on, and a full stop. A short
   * caption after either of those is correct, and "Right." is a caption.
   *
   * A third is added for the same reason bestCut gained one: a gap under
   * maxGapS can still be the pause bestCut deliberately cut on -- the
   * reported case measured ~0.28s against a 0.5s maxGapS. Without this,
   * rebalance would see the caption it starts (often exactly at the floor,
   * since that pause is usually why the run was short) and pull the word
   * bestCut just moved away from it right back across the same pause,
   * quietly undoing the fix for the one shape of caption most likely to
   * need it. GAP_ABS_FLOOR alone is the check here, not the fuller
   * relative-to-the-window test bestCut uses: a merge only ever looks at
   * ONE gap, not a run of them, so there is no window to measure "typical"
   * against, and the absolute floor is the part of that test which does not
   * need one.
   */
  function rebalance(groups, opts) {
    var budget = opts.maxCharsPerLine * opts.maxLines;
    var floor = Math.max(1, opts.minWords || 1);

    function fits(words) {
      return words.length <= opts.maxWords &&
             joinedLength(words) <= budget &&
             spanOf(words) <= opts.maxDurationS;
    }

    for (var i = 1; i < groups.length; i++) {
      var tail = groups[i];
      if (tail.length >= floor) continue;

      var head = groups[i - 1];
      var last = head[head.length - 1];
      var gap = tail[0].start - last.end;
      // A pause bestCut would have cut on -- clear of the floor AND standing
      // out from how this speaker spaces the caption before it -- is the
      // speaker's break, so it is not undone here. The floor alone is not
      // enough: a slow, even speaker leaves 0.3s between every word, and
      // refusing to move any of those would strand words for nothing.
      if (gap > opts.maxGapS) continue;
      if (gap >= GAP_ABS_FLOOR &&
          gap >= GAP_MEDIAN_MULT * medianGap(head, 0, head.length)) continue;
      if (SENTENCE_END.test(last.text)) continue;

      // Never rob the caption before to the point of stranding IT: stop while
      // it still holds the floor.
      while (tail.length < floor && head.length > floor) {
        var moved = [head[head.length - 1]].concat(tail);
        if (!fits(moved)) break;
        head.pop();
        tail = moved;
      }
      groups[i] = tail;
    }
    return groups;
  }

  function segmentByPhrase(words, options) {
    var opts = merge(PHRASE_DEFAULTS, options);
    var groups = rebalance(groupByPhrase(words, opts), opts);
    return hold(groups.map(function (group) {
      return buildCaption(group, opts);
    }));
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
   *
   * It is the phrase grouper with sentence-shaped budgets, which is all it
   * ever was: maxGapS of 99 means no pause can cut it, and the duration is
   * the only bound that binds. Sharing the machinery is not tidiness -- it is
   * how the cap's cuts get placed. Left to itself the cap fired wherever the
   * seconds ran out, which put "supports me." on a layer of its own; through
   * bestCut it lands on the last comma instead and the sentence breaks after
   * "...as a person," where it reads as intended.
   */
  function segmentBySentence(words, options) {
    return segmentByPhrase(words, merge(SENTENCE_DEFAULTS, options));
  }

  /**
   * Choose a shape from the comp, then group on the pauses within it.
   *
   * This is the only "smart" mode. It used to be one of two -- comp-aware
   * phrase pacing, and a separate 2-5 word pause grouping -- which is a
   * distinction users had no reason to care about. They are the same idea:
   * read the comp, then cut where the speaker actually stops. The comp
   * decides how many words fit; the pauses decide where the cut lands.
   *
   * The floor is what makes it feel deliberate rather than twitchy: without
   * it a half-second hesitation after the first word emits a one-word
   * caption in the middle of a sentence.
   */
  function segmentSmart(words, width, height, options) {
    var layout = chooseLayout(width, height);
    var opts = merge(merge(layout.options, { minWords: 2 }), options);
    return {
      layout: layout,
      captions: segmentByPhrase(words, opts)
    };
  }

  /**
   * Sentences, wrapped to the comp.
   *
   * Where the cut lands is the speaker's business and nothing here changes
   * that -- a sentence is a sentence on any comp. How WIDE it is allowed to
   * get is the comp's business: 42 characters is a broadcast measure, and on
   * a 1080x1920 comp a line that long runs off both edges. That is not
   * hypothetical, it is what the panel shipped in v0.4.0 and a screenshot of
   * it is in the commit that fixed it.
   *
   * So the line width comes from the comp and the line COUNT follows from it,
   * holding roughly the same total as the broadcast shape. It has to: a
   * narrower line needs more of them, and wrapLines puts whatever will not
   * fit on the final line rather than dropping it, so a count set too low
   * overflows exactly the way an over-wide line does.
   */
  var SENTENCE_WRAP_BUDGET =
    SENTENCE_DEFAULTS.maxCharsPerLine * SENTENCE_DEFAULTS.maxLines;

  function segmentSentenceForComp(words, width, height, options) {
    var layout = chooseLayout(width, height);
    var chars = layout.options.maxCharsPerLine;
    var shaped = merge(SENTENCE_DEFAULTS, {
      maxCharsPerLine: chars,
      maxLines: Math.max(2, Math.ceil(SENTENCE_WRAP_BUDGET / chars))
    });
    return {
      layout: {
        orientation: layout.orientation,
        aspect: layout.aspect,
        options: shaped,
        rationale:
          "One caption per sentence, wrapped at " + chars +
          " characters per line for this " + layout.orientation + " comp."
      },
      captions: segmentBySentence(words, merge(shaped, options))
    };
  }

  /**
   * Entry point.
   *
   * @param {Array} words backend word list ({text, start, end, confidence})
   * @param {object} config
   *   mode: "one"|"two"|"three"  exactly N words per caption
   *         "parts"              2-5 words, grouped on pauses
   *         "sentence"           one sentence per caption, wrapped to the comp
   *         "smart"              phrase pacing sized to the comp shape
   *         "phrase"             broadcast pacing (the default)
   *         "word"               historical alias for "one"
   *   width, height: comp dimensions. "smart" sizes its captions to them;
   *         "sentence" wraps to them. The fixed counts ignore them.
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
      var bySentence =
        segmentSentenceForComp(list, cfg.width, cfg.height, cfg.options);
      return {
        mode: mode,
        layout: bySentence.layout,
        captions: bySentence.captions
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
    MAX_HOLD_S: MAX_HOLD_S,
    COUNT_MODES: COUNT_MODES,
    chooseLayout: chooseLayout,
    wrapLines: wrapLines,
    segmentByCount: segmentByCount,
    segmentByPhrase: segmentByPhrase,
    segmentBySentence: segmentBySentence,
    segmentSentenceForComp: segmentSentenceForComp,
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
