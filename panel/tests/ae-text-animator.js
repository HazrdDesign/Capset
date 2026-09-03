/**
 * How After Effects actually evaluates a text animator.
 *
 * This exists because the test suite could not tell a working animation from
 * one that cancels itself out. fake-ae.js modelled a Range Selector as a bag
 * with a couple of properties and no semantics, so every animation test could
 * assert only that an animator had been CREATED with certain keyframes --
 * never that the resulting motion was the motion intended. A shipped build
 * therefore had entrances that barely moved, with 200+ tests passing.
 *
 * The one thing that matters, and the thing that was missing: a Range
 * Selector does not delay an animation per character. It scales HOW MUCH of
 * the animator reaches each character. Adobe's own wording: "At 0%, the
 * animator properties do not affect the characters." So an animator whose
 * selector covers nothing has no effect at all, whatever its property
 * keyframes say.
 *
 * Deliberately an approximation, in the same spirit as the rest of the fake:
 * coverage is linear across a unit, Shape and Smoothness are not modelled.
 * That is enough to catch "this animation does nothing", which is the class
 * of bug that got through.
 */
"use strict";

/** Linear value of a keyframed property at `time`, clamped outside the keys. */
function valueAt(property, time) {
  if (!property) return null;
  const keys = property.keys;
  if (!keys || !keys.length) return property.value;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      const k = span === 0 ? 0 : (time - a.time) / span;
      return lerp(a.value, b.value, k);
    }
  }
  return keys[keys.length - 1].value;
}

function lerp(from, to, k) {
  if (Array.isArray(from) || Array.isArray(to)) {
    const a = Array.isArray(from) ? from : [from, from];
    const b = Array.isArray(to) ? to : [to, to];
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      out.push(lerp(a[i] === undefined ? 0 : a[i], b[i] === undefined ? 0 : b[i], k));
    }
    return out;
  }
  return from + (to - from) * k;
}

/**
 * The share of unit `index` (of `count`) covered by the selector range.
 *
 * Units are laid out evenly across 0-100%. The selection is
 * [start + offset, end + offset]; the amount is how much of the unit's own
 * span that selection covers, 0..1.
 */
function coverage(index, count, start, end, offset) {
  const unitStart = (index / count) * 100;
  const unitEnd = ((index + 1) / count) * 100;
  const lo = Math.min(start, end) + offset;
  const hi = Math.max(start, end) + offset;

  const overlap = Math.min(unitEnd, hi) - Math.max(unitStart, lo);
  if (overlap <= 0) return 0;
  return overlap / (unitEnd - unitStart);
}

/** Read a selector's Start/End/Offset at `time`, with AE's defaults. */
function selectorAt(selector, time) {
  const read = (matchName, fallback) => {
    let prop = null;
    try { prop = selector.property(matchName); } catch (e) { prop = null; }
    if (!prop) return fallback;
    const v = valueAt(prop, time);
    return v === null || v === undefined ? fallback : v;
  };
  return {
    start: read("ADBE Text Percent Start", 0),
    end: read("ADBE Text Percent End", 100),
    offset: read("ADBE Text Percent Offset", 0)
  };
}

/**
 * How much of `animator` reaches unit `index` at `time`, 0..1.
 *
 * This is the number the animation bug was hiding in: it was 0 at both the
 * start and the end of every entrance, so the from-pose never appeared and
 * the overshoot never landed.
 */
function amountAt(animator, time, index, count) {
  const selectors = animator.property("ADBE Text Selectors");
  if (!selectors || !selectors.numProperties) return 1;
  const selector = selectors.property(1);
  const { start, end, offset } = selectorAt(selector, time);
  return coverage(index, count, start, end, offset);
}

/**
 * The value a unit actually ends up at, blending the animator's property
 * towards the layer's natural pose by the selector amount.
 *
 * `rest` is the value the property has with no animator applied (scale 100,
 * opacity 100, position 0...). At amount 0 the unit sits at rest; at amount 1
 * it sits at the animator's value.
 */
function effectiveValue(animator, matchName, time, index, count, rest) {
  const props = animator.property("ADBE Text Animator Properties");
  let prop = null;
  try { prop = props.property(matchName); } catch (e) { prop = null; }
  if (!prop) return rest;

  const animated = valueAt(prop, time);
  const amount = amountAt(animator, time, index, count);
  return lerp(rest, animated, amount);
}

module.exports = { valueAt, coverage, selectorAt, amountAt, effectiveValue, lerp };
