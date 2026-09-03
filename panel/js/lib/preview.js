/**
 * Live animation previews, driven from the animation definitions themselves.
 *
 * The alternative was pre-rendered video loops, the way Motion Bro and
 * Animation Composer do it. That was the original plan and it does not
 * survive contact with reality here: the loops have to be rendered by running
 * a script inside After Effects, the files are build artifacts excluded from
 * the repository, and nothing in the build produces them — so the shipped
 * panel showed "no preview" on every card. A preview that only exists if
 * someone remembers to render it is not a preview.
 *
 * Driving the preview from the same JSON the host script reads means it
 * cannot drift from what actually gets applied, and it costs no build step,
 * no files, and no download.
 *
 * It is an APPROXIMATION, and deliberately an honest one. The browser is not
 * After Effects: keyframe influence becomes a cubic bezier, the range
 * selector's sweep becomes a fixed stagger, and text rendering is the panel's
 * font rather than the comp's. It shows the character of the motion — punch,
 * overshoot, direction, colour, stagger — which is what someone picking from
 * a grid is actually choosing between.
 *
 * The sampling core is pure and runs under node; only attach() touches DOM.
 */
(function (root) {
  "use strict";

  // Share of the phase spent staggering across units. The host sweeps the
  // range selector's Start from 0 to 100, so the range's edge crosses the
  // text over the phase and units resolve one after another with heavy
  // overlap. Modelling that as a per-unit delay is not the same mechanism --
  // AE scales how much of the animator reaches each unit rather than delaying
  // it -- but it produces the same read: staggered resolution, front to back.
  var STAGGER = 0.7;
  // Where an overshooting property reaches its first peak, matching
  // capsetSpringKeys in the host script.
  var OVERSHOOT_PEAK = 0.65;

  var REST = {
    opacity: 100,
    position: [0, 0],
    scale: [100, 100],
    rotation: 0,
    blur: [0, 0],
    tracking: 0,
    fillColor: null
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /**
   * After Effects keyframe influence as a cubic bezier.
   *
   * Influence is how far a keyframe's handle reaches into the segment, so a
   * high value means a more gradual change at that end. The handles sit at
   * y = 0 and y = 1 because the host script always uses speed 0.
   */
  function easing(easeIn, easeOut) {
    var x1 = clamp01((easeOut === undefined ? 66 : easeOut) / 100);
    var x2 = 1 - clamp01((easeIn === undefined ? 33 : easeIn) / 100);
    return function (t) { return bezier(clamp01(t), x1, x2); };
  }

  function bezierX(t, x1, x2) {
    var u = 1 - t;
    return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
  }

  function bezierY(t) {
    // y1 = 0, y2 = 1, so this reduces to 3u t^2 + t^3.
    var u = 1 - t;
    return 3 * u * t * t + t * t * t;
  }

  /** Solve x(t) = target for t, then read y. Newton with a bisection floor. */
  function bezier(x, x1, x2) {
    var t = x;
    var i;
    for (i = 0; i < 8; i++) {
      var error = bezierX(t, x1, x2) - x;
      if (Math.abs(error) < 1e-5) return bezierY(t);
      var slope = 3 * (1 - t) * (1 - t) * x1 +
                  6 * (1 - t) * t * (x2 - x1) +
                  3 * t * t * (1 - x2);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
      t = clamp01(t);
    }
    var low = 0, high = 1;
    for (i = 0; i < 20; i++) {
      t = (low + high) / 2;
      if (bezierX(t, x1, x2) < x) low = t; else high = t;
    }
    return bezierY(t);
  }

  function lerp(from, to, k) {
    if (from instanceof Array || to instanceof Array) {
      var a = from instanceof Array ? from : [from, from];
      var b = to instanceof Array ? to : [to, to];
      var out = [];
      for (var i = 0; i < Math.max(a.length, b.length); i++) {
        out.push(lerp(a[i] === undefined ? 0 : a[i], b[i] === undefined ? 0 : b[i], k));
      }
      return out;
    }
    return from + (to - from) * k;
  }

  /** Matches capsetOvershootValue in the host script: measured against travel. */
  function overshootValue(from, to, overshoot) {
    var extra = overshoot - 1;
    if (to instanceof Array) {
      var out = [];
      for (var i = 0; i < to.length; i++) {
        var start = from instanceof Array ? from[i] : from;
        out.push(to[i] + (to[i] - start) * extra);
      }
      return out;
    }
    return to + (to - from) * extra;
  }

  /** A unit's own progress through a phase, given the stagger across units. */
  function staggered(progress, unitIndex, unitCount, stagger) {
    if (unitCount <= 1) return clamp01(progress);
    var slot = (unitIndex / (unitCount - 1)) * stagger;
    var span = 1 - stagger;
    if (span <= 0) return progress >= slot ? 1 : 0;
    return clamp01((progress - slot) / span);
  }

  /**
   * The value stops a spring passes through, as {at, value} through the phase.
   *
   * Mirrors capsetSpringKeys in the host script, including its caps, so the
   * card in the grid shows the motion that will actually be applied. The
   * first and last stops are the from-pose and the target.
   */
  function springStops(from, to, overshoot, bounces, damping) {
    var stops = [{ at: 0, value: from }];
    var count = bounces > 0 ? Math.floor(bounces) : 1;
    if (count > 4) count = 4;
    var decay = (damping > 0 && damping < 1) ? damping : 0.5;
    var amplitude = overshoot - 1;

    for (var i = 0; i < count; i++) {
      var signed = 1 + amplitude * (i % 2 === 0 ? 1 : -1);
      stops.push({
        at: OVERSHOOT_PEAK + (1 - OVERSHOOT_PEAK) * (i / (count + 1)),
        value: overshootValue(from, to, signed)
      });
      amplitude *= decay;
    }
    stops.push({ at: 1, value: to });
    return stops;
  }

  /** Interpolate between spring stops at `local` (0-1 through the phase). */
  function sampleStops(stops, local, ease) {
    for (var i = 0; i < stops.length - 1; i++) {
      var a = stops[i];
      var b = stops[i + 1];
      if (local <= b.at || i === stops.length - 2) {
        var span = b.at - a.at;
        var k = span <= 0 ? 1 : clamp01((local - a.at) / span);
        // Only the first and last segments are eased, matching the host,
        // which leaves the spring's own crossings linear so the motion
        // carries through them instead of stopping dead at each peak.
        var shaped = (i === 0 || i === stops.length - 2) ? ease(k) : k;
        return lerp(a.value, b.value, shaped);
      }
    }
    return stops[stops.length - 1].value;
  }

  function applyPhase(state, phase, progress, unitIndex, unitCount, resolveColor) {
    if (!phase || !phase.properties) return;
    var ease = easing(phase.ease && phase.ease["in"], phase.ease && phase.ease.out);
    var local = staggered(progress, unitIndex, unitCount, STAGGER);

    for (var i = 0; i < phase.properties.length; i++) {
      var spec = phase.properties[i];
      var from = spec.from === "$textColor" ? resolveColor() : spec.from;
      var to = spec.to === "$textColor" ? resolveColor() : spec.to;
      var overshoot = Number(spec.overshoot);

      var value;
      if (overshoot > 1) {
        // Walk the same spring the host builds: rise to the first peak, then
        // through each decaying crossing, then settle. With no bounces
        // declared this is one peak, which is the single-overshoot shape.
        var stops = springStops(from, to, overshoot,
                                Number(spec.bounces), Number(spec.damping));
        value = sampleStops(stops, local, ease);
      } else {
        value = lerp(from, to, ease(local));
      }
      state[spec.type] = value;
    }
  }

  /**
   * Every animated property's value at time `t` for one unit of text.
   *
   * @param animation  an entry from animations.json
   * @param timings    the output of CapsetTiming.computeTimings
   * @param unitIndex  0-based index of this word or character
   * @param unitCount  how many units the caption has
   * @param t          seconds since the layer's in point
   */
  function sampleUnit(animation, timings, unitIndex, unitCount, t, options) {
    options = options || {};
    var resolveColor = options.textColor
      ? function () { return options.textColor; }
      : function () { return [1, 1, 1]; };

    var state = {};
    for (var key in REST) {
      if (Object.prototype.hasOwnProperty.call(REST, key)) {
        state[key] = REST[key] instanceof Array ? REST[key].slice() : REST[key];
      }
    }
    if (!animation) return state;

    var inDuration = timings.inDuration || 0;
    if (animation["in"] && inDuration > 0) {
      if (t < timings.inStart) {
        applyPhase(state, animation["in"], 0, unitIndex, unitCount, resolveColor);
      } else if (t < timings.inStart + inDuration) {
        applyPhase(state, animation["in"],
                   (t - timings.inStart) / inDuration,
                   unitIndex, unitCount, resolveColor);
      }
    }

    var outDuration = timings.outDuration || 0;
    if (animation.out && outDuration > 0 && t >= timings.outStart) {
      applyPhase(state, animation.out,
                 Math.min(1, (t - timings.outStart) / outDuration),
                 unitIndex, unitCount, resolveColor);
    }
    return state;
  }

  /** Split preview text the same way the animation's selector would. */
  function splitUnits(text, basedOn) {
    if (basedOn === "words" || basedOn === "lines") {
      return text.split(/\s+/).filter(function (w) { return w.length > 0; });
    }
    return text.split("");
  }

  function css(value) {
    return Math.round(value * 1000) / 1000;
  }

  function colorToCss(rgb) {
    if (!rgb) return "";
    return "rgb(" + rgb.slice(0, 3).map(function (c) {
      return Math.round(clamp01(c) * 255);
    }).join(",") + ")";
  }

  /** Turn a sampled state into the styles one unit needs. */
  function stylesFor(state) {
    var position = state.position || [0, 0];
    var scale = state.scale || [100, 100];
    var blur = state.blur || [0, 0];
    return {
      // Scaled down: the definitions are in comp pixels and a preview card is
      // a couple of centimetres wide.
      transform: "translate(" + css(position[0] * 0.18) + "px," +
                 css(position[1] * 0.18) + "px) " +
                 "scale(" + css(scale[0] / 100) + "," + css(scale[1] / 100) + ") " +
                 "rotate(" + css(state.rotation || 0) + "deg)",
      opacity: String(css(clamp01((state.opacity === undefined ? 100 : state.opacity) / 100))),
      filter: blur[0] > 0.05 ? "blur(" + css(blur[0] * 0.06) + "px)" : "",
      letterSpacing: state.tracking ? css(state.tracking * 0.04) + "em" : "",
      color: colorToCss(state.fillColor)
    };
  }

  var api = {
    sampleUnit: sampleUnit,
    splitUnits: splitUnits,
    stylesFor: stylesFor,
    easing: easing,
    overshootValue: overshootValue,
    springStops: springStops,
    staggered: staggered,
    STAGGER: STAGGER,
    OVERSHOOT_PEAK: OVERSHOOT_PEAK
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetPreview = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
