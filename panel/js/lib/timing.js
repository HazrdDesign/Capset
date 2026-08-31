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

    var inDur = clamp(duration * s.inFraction, s.inMin, s.inMax);
    // The cap wins over inMin: resolving early matters more than a minimum.
    inDur = Math.min(inDur, duration * s.maxInFraction);

    var outDur = 0;
    if (spec && spec.hasOut === false) {
      outDur = 0;
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

  /** Fraction of the layer at which the in-animation finishes (0-1). */
  function resolveFraction(layerDuration, spec) {
    var duration = Math.max(0, Number(layerDuration) || 0);
    if (duration === 0) return 0;
    return computeTimings(duration, spec).inEnd / duration;
  }

  var api = {
    DEFAULTS: DEFAULTS,
    clamp: clamp,
    computeTimings: computeTimings,
    resolveFraction: resolveFraction
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetTiming = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
