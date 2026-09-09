/**
 * Duration-adaptive animation timing.
 *
 * Preset- and marker-driven systems (Mister Horse, .ffx files) bake fixed
 * keyframes, so an animation tuned for a 2.5s phrase resolves far too late on
 * a 0.3s word. Caption durations vary by an order of magnitude, so the fix is
 * to express each phase as a FRACTION of the layer's duration, clamped to
 * absolute bounds so it neither snaps nor drags at the extremes.
 *
 * Pure and dependency-free: runs in the CEP panel and under node for tests.
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    // In-animation: a quarter of the layer, but never below 0.10s (snappy to
    // the point of invisible) or above 0.45s (starts to feel sluggish).
    inFraction: 0.25,
    inMin: 0.1,
    inMax: 0.45,

    outFraction: 0.2,
    outMin: 0.08,
    outMax: 0.35,

    // Hard guarantee: the in-animation always finishes within this share of
    // the layer. This is the user-facing "resolve within 20-50%" control, and
    // it overrides inMin -- on a very short word a fast animation beats one
    // that is still moving when the word disappears.
    maxInFraction: 0.5,
    maxOutFraction: 0.4,

    // In and out together may not exceed this share, so a short caption is
    // never wall-to-wall motion with no readable hold.
    maxTotalFraction: 0.9
  };

  function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
  }

  /** A usable explicit duration: a real number above zero. */
  function isPositive(value) {
    return value !== undefined && value !== null && isFinite(value) && Number(value) > 0;
  }

  /**
   * Seconds from a length the user typed.
   *
   * Frames are what people actually count animation in, and a frame is only
   * meaningful against a frame rate, so the comp's rate has to come with it.
   */
  function toSeconds(value, unit, frameRate) {
    var amount = Number(value);
    if (!isFinite(amount) || amount <= 0) return 0;
    if (unit === "frames") {
      var rate = Number(frameRate);
      if (!isFinite(rate) || rate <= 0) rate = 30;
      return amount / rate;
    }
    return amount;
  }

  /**
   * @param {number} layerDuration seconds the caption layer is visible
   * @param {object} [spec] overrides of DEFAULTS; `hasOut: false` disables the
   *        out phase entirely
   * @returns {{inStart, inDuration, inEnd, outStart, outDuration, outEnd,
   *            holdDuration}} all seconds, relative to the layer's in-point
   */
  function computeTimings(layerDuration, spec) {
    var s = {};
    var key;
    for (key in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        s[key] = DEFAULTS[key];
      }
    }
    if (spec) {
      for (key in spec) {
        if (Object.prototype.hasOwnProperty.call(spec, key)) {
          s[key] = spec[key];
        }
      }
    }

    var duration = Math.max(0, Number(layerDuration) || 0);
    if (duration === 0) {
      return {
        inStart: 0, inDuration: 0, inEnd: 0,
        outStart: 0, outDuration: 0, outEnd: 0,
        holdDuration: 0
      };
    }

    // An explicit length wins over the fraction rules.
    //
    // The fraction model scales every animation to its caption, which stops a
    // long entrance dragging on a short word but also means one preset runs
    // for a different length on every caption -- so it never has a consistent
    // feel, and "Word Pop" on a 1.2s caption looks nothing like it does on a
    // 0.35s one. The caps below still apply, so an explicit length can shorten
    // itself on a very short caption but can never overrun it.
    var inDur;
    if (isPositive(s.inSeconds)) {
      inDur = Number(s.inSeconds);
    } else {
      inDur = clamp(duration * s.inFraction, s.inMin, s.inMax);
    }
    // The cap wins over inMin: resolving early matters more than a minimum.
    inDur = Math.min(inDur, duration * s.maxInFraction);

    var outDur = 0;
    if (spec && spec.hasOut === false) {
      outDur = 0;
    } else if (isPositive(s.outSeconds)) {
      outDur = Math.min(Number(s.outSeconds), duration * s.maxOutFraction);
    } else {
      outDur = clamp(duration * s.outFraction, s.outMin, s.outMax);
      outDur = Math.min(outDur, duration * s.maxOutFraction);
    }

    // Scale both proportionally rather than truncating one, which would
    // silently favour whichever phase happened to be computed first.
    var budget = duration * s.maxTotalFraction;
    if (inDur + outDur > budget && inDur + outDur > 0) {
      var scale = budget / (inDur + outDur);
      inDur *= scale;
      outDur *= scale;
    }

    inDur = Math.max(0, inDur);
    outDur = Math.max(0, outDur);

    return {
      inStart: 0,
      inDuration: inDur,
      inEnd: inDur,
      outStart: duration - outDur,
      outDuration: outDur,
      outEnd: duration,
      holdDuration: Math.max(0, duration - inDur - outDur)
    };
  }

  /**
   * Turn an animation DEFINITION into a spec computeTimings understands.
   *
   * The adapter between the two halves of the system: the library describes
   * its phases as fractions of the caption, and everything that applies one
   * -- the host script, and whatever draws a preview -- needs those as a
   * spec. It lived inline in the panel's main.js until the Animate tab was
   * removed; it is the definition's meaning, not the tab's, so it moved here
   * rather than going with it.
   *
   * @param animation an entry from animations.json
   * @param options   {resolvePercent, lengthSeconds} from the UI, both optional
   */
  function specForAnimation(animation, options) {
    var opts = options || {};
    var spec = {};

    if (isPositive(opts.resolvePercent)) {
      spec.maxInFraction = Number(opts.resolvePercent) / 100;
    }
    if (isPositive(opts.lengthSeconds)) {
      spec.inSeconds = Number(opts.lengthSeconds);
    }

    // A karaoke fill is supposed to run the length of the caption -- that IS
    // the effect. The resolve-early cap exists so an entrance is not still
    // moving when the word disappears, which is a different thing, so an
    // animation that spans the layer opts out of it.
    if (animation && animation.spansLayer) {
      spec.maxInFraction = 1;
      spec.maxTotalFraction = 1;
    }
    if (animation && animation["in"]) {
      spec.inFraction = animation["in"].fraction;
      spec.inMin = animation["in"].min;
      spec.inMax = animation["in"].max;
    }
    if (animation && animation.out) {
      spec.outFraction = animation.out.fraction;
      spec.outMin = animation.out.min;
      spec.outMax = animation.out.max;
    } else {
      spec.hasOut = false;
    }
    return spec;
  }

  /** Fraction of the layer at which the in-animation finishes (0-1). */
  function resolveFraction(layerDuration, spec) {
    var duration = Math.max(0, Number(layerDuration) || 0);
    if (duration === 0) return 0;
    return computeTimings(duration, spec).inEnd / duration;
  }

  var api = {
    DEFAULTS: DEFAULTS,
    clamp: clamp,
    toSeconds: toSeconds,
    computeTimings: computeTimings,
    specForAnimation: specForAnimation,
    resolveFraction: resolveFraction
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetTiming = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
