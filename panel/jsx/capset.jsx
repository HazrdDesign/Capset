/*
 * Capset — After Effects host script.
 *
 * ExtendScript is ES3: no JSON, no let/const, no arrow functions, no
 * Array.prototype.forEach/map/filter. Everything here is plain var and
 * indexed for-loops on purpose. json2.jsx supplies JSON.
 *
 * Timing is NOT computed here. js/lib/timing.js computes it in the panel,
 * where it is unit-tested, and passes resolved seconds down. This file only
 * applies them, so the duration-adaptive rules have exactly one
 * implementation and it is the tested one.
 *
 * STATUS: not yet executed inside After Effects. Match names and API shapes
 * follow the AE scripting reference, but nothing below is verified against a
 * running host. Treat as a first draft until it has been run.
 */

#include "json2.jsx"

var CAPSET_PREFIX = "Capset__";
var CAPSET_CONTROLLER = "Capset Controller";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function capsetOk(data) {
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
}

function capsetErr(message) {
    return JSON.stringify({ ok: false, error: String(message) });
}

function capsetActiveComp() {
    var item = app.project ? app.project.activeItem : null;
    if (!item || !(item instanceof CompItem)) {
        throw new Error("Select a composition first.");
    }
    return item;
}

/** Round to whole frames so layers land on frame boundaries, not between. */
function capsetSnap(comp, seconds) {
    if (!comp.frameDuration) return seconds;
    return Math.round(seconds / comp.frameDuration) * comp.frameDuration;
}

// ---------------------------------------------------------------------------
// comp info — the panel needs dimensions to choose a smart layout
// ---------------------------------------------------------------------------

function capsetGetCompInfo() {
    try {
        var comp = capsetActiveComp();
        return capsetOk({
            name: comp.name,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frameRate: comp.frameRate,
            frameDuration: comp.frameDuration,
            workAreaStart: comp.workAreaStart,
            workAreaDuration: comp.workAreaDuration,
            numLayers: comp.numLayers
        });
    } catch (e) {
        return capsetErr(e.message);
    }
}

// ---------------------------------------------------------------------------
// text layers
// ---------------------------------------------------------------------------

function capsetStyleText(layer, style, comp) {
    var prop = layer.property("Source Text");
    var doc = prop.value;

    if (style.font) doc.font = style.font;
    if (style.fontSize) doc.fontSize = style.fontSize;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;

    // NOTE: TextDocument.fillColor assignment is flagged UNVERIFIED in
    // docs/research/01-ae-extensibility.md — some AE versions ignore it from
    // script. If it proves unreliable, fall back to an ADBE Fill effect on
    // the layer, which is what the community recommends.
    if (style.fillColor) {
        doc.applyFill = true;
        doc.fillColor = style.fillColor;
    }
    if (style.strokeColor && style.strokeWidth) {
        doc.applyStroke = true;
        doc.strokeColor = style.strokeColor;
        doc.strokeWidth = style.strokeWidth;
        doc.strokeOverFill = false;
    }
    prop.setValue(doc);

    // Position captions in the lower third by default, inside title-safe.
    var y = comp.height * (style.positionY === undefined ? 0.82 : style.positionY);
    var x = comp.width * 0.5;
    layer.property("Transform").property("Position").setValue([x, y]);
}

// ---------------------------------------------------------------------------
// procedural text animators
//
// Generated rather than applied from .ffx: .ffx bakes fixed keyframes that
// cannot adapt to caption duration, and cannot be cleanly removed when the
// user swaps animation. Everything created here carries CAPSET_PREFIX so a
// swap is an exact teardown and rebuild.
// ---------------------------------------------------------------------------

var CAPSET_PROPERTY_MATCH = {
    position: "ADBE Text Position 3D",
    scale: "ADBE Text Scale 3D",
    rotation: "ADBE Text Rotation",
    opacity: "ADBE Text Opacity",
    blur: "ADBE Text Blur"
};

var CAPSET_BASED_ON = {
    characters: 1,
    charactersExcludingSpaces: 2,
    words: 3,
    lines: 4
};

function capsetRemoveAnimators(layer) {
    var removed = 0;
    var animators = layer
        .property("ADBE Text Properties")
        .property("ADBE Text Animators");
    // Backwards: removing shifts the indices of everything after it.
    for (var i = animators.numProperties; i >= 1; i--) {
        var animator = animators.property(i);
        if (animator && animator.name.indexOf(CAPSET_PREFIX) === 0) {
            animator.remove();
            removed++;
        }
    }
    return removed;
}

function capsetToValue(spec, key) {
    var raw = spec[key];
    if (raw instanceof Array) {
        return raw.length === 2 ? [raw[0], raw[1], 0] : raw;
    }
    return raw;
}

/**
 * Build one animator phase.
 *
 * @param layer       the text layer
 * @param name        animator name (prefixed)
 * @param phase       animation definition's in/out block
 * @param startTime   absolute comp time the phase begins
 * @param duration    phase length in seconds
 * @param reverse     true for the out phase (animates away from the hold)
 */
function capsetAddPhase(layer, name, phase, startTime, duration, basedOn) {
    if (!phase || !phase.properties || !phase.properties.length || duration <= 0) {
        return null;
    }

    var animators = layer
        .property("ADBE Text Properties")
        .property("ADBE Text Animators");
    var animator = animators.addProperty("ADBE Text Animator");
    animator.name = name;

    var props = animator.property("ADBE Text Animator Properties");
    var selectors = animator.property("ADBE Text Selectors");
    var selector = selectors.addProperty("ADBE Text Selector");

    if (basedOn && CAPSET_BASED_ON[basedOn]) {
        try {
            selector.property("ADBE Text Range Type2").setValue(
                CAPSET_BASED_ON[basedOn]
            );
        } catch (e) {
            // Older hosts name this differently; the default (characters) is
            // an acceptable fallback rather than a reason to fail the build.
        }
    }

    var easeIn = phase.ease && phase.ease.in !== undefined ? phase.ease.in : 33;
    var easeOut = phase.ease && phase.ease.out !== undefined ? phase.ease.out : 66;

    for (var i = 0; i < phase.properties.length; i++) {
        var spec = phase.properties[i];
        var matchName = CAPSET_PROPERTY_MATCH[spec.type];
        if (!matchName) continue;

        var prop;
        try {
            prop = props.addProperty(matchName);
        } catch (e) {
            continue; // property unsupported on this host; skip, do not abort
        }

        var from = capsetToValue(spec, "from");
        var to = capsetToValue(spec, "to");

        prop.setValueAtTime(startTime, from);
        prop.setValueAtTime(startTime + duration, to);

        // Ease both keys. KeyframeEase(speed, influence); influence is the
        // percentage that gives the curve its shape.
        try {
            var n = prop.numKeys;
            var dims = (from instanceof Array) ? from.length : 1;
            var inEase = [];
            var outEase = [];
            for (var d = 0; d < dims; d++) {
                inEase.push(new KeyframeEase(0, easeIn));
                outEase.push(new KeyframeEase(0, easeOut));
            }
            if (dims === 1) {
                prop.setTemporalEaseAtKey(n - 1, [inEase[0]], [outEase[0]]);
                prop.setTemporalEaseAtKey(n, [inEase[0]], [outEase[0]]);
            } else {
                prop.setTemporalEaseAtKey(n - 1, inEase, outEase);
                prop.setTemporalEaseAtKey(n, inEase, outEase);
            }
        } catch (e) {
            // Easing is cosmetic; linear keys are still a working animation.
        }
    }

    // Range selector sweeps 0 -> 100% so characters/words stagger rather
    // than all moving together.
    try {
        var offset = selector.property("ADBE Text Percent Offset");
        offset.setValueAtTime(startTime, -100);
        offset.setValueAtTime(startTime + duration, 100);
    } catch (e) {
        // No offset property: the animator still runs, just without stagger.
    }

    return animator;
}

function capsetApplyAnimation(layer, animation, timings) {
    capsetRemoveAnimators(layer);
    if (!animation) return 0;

    var applied = 0;
    var basedOn = animation.basedOn || "characters";

    if (timings.inDuration > 0 && animation["in"]) {
        if (capsetAddPhase(
            layer, CAPSET_PREFIX + animation.id + "__in",
            animation["in"], layer.inPoint + timings.inStart,
            timings.inDuration, basedOn
        )) applied++;
    }

    if (timings.outDuration > 0 && animation.out) {
        if (capsetAddPhase(
            layer, CAPSET_PREFIX + animation.id + "__out",
            animation.out, layer.inPoint + timings.outStart,
            timings.outDuration, basedOn
        )) applied++;
    }

    return applied;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function capsetBuildCaptions(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson);
        var captions = payload.captions || [];
        var style = payload.style || {};
        var animation = payload.animation || null;
        var offset = payload.timeOffset || 0;

        if (!captions.length) throw new Error("No captions to build.");

        var comp = capsetActiveComp();

        app.beginUndoGroup("Capset: build captions");
        undoOpen = true;

        var created = [];
        for (var i = 0; i < captions.length; i++) {
            var caption = captions[i];
            var text = caption.lines ? caption.lines.join("\r") : caption.text;

            var layer = comp.layers.addText(text);
            layer.name = CAPSET_PREFIX + "cap_" + (i + 1);
            layer.inPoint = capsetSnap(comp, offset + caption.start);
            layer.outPoint = capsetSnap(comp, offset + caption.end);

            capsetStyleText(layer, style, comp);

            if (animation && caption.timings) {
                capsetApplyAnimation(layer, animation, caption.timings);
            }
            created.push(layer.index);
        }

        return capsetOk({ created: created.length, layerIndices: created });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

// ---------------------------------------------------------------------------
// swap animation — the quality-of-life feature .ffx cannot support well
// ---------------------------------------------------------------------------

function capsetIsCapsetLayer(layer) {
    return layer && layer.name && layer.name.indexOf(CAPSET_PREFIX) === 0;
}

/**
 * @param payloadJson {animation, timingsById?, scope: "selected"|"all"}
 */
function capsetReplaceAnimation(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson);
        var animation = payload.animation || null;
        var scope = payload.scope || "selected";
        var timingsById = payload.timingsById || {};

        var comp = capsetActiveComp();

        var targets = [];
        var i;
        if (scope === "all") {
            for (i = 1; i <= comp.numLayers; i++) {
                var candidate = comp.layer(i);
                if (candidate instanceof TextLayer && capsetIsCapsetLayer(candidate)) {
                    targets.push(candidate);
                }
            }
        } else {
            var selected = comp.selectedLayers;
            for (i = 0; i < selected.length; i++) {
                if (selected[i] instanceof TextLayer) targets.push(selected[i]);
            }
        }

        if (!targets.length) {
            throw new Error(
                scope === "all"
                    ? "No Capset caption layers in this comp."
                    : "Select at least one text layer."
            );
        }

        app.beginUndoGroup("Capset: replace animation");
        undoOpen = true;

        var changed = 0;
        for (i = 0; i < targets.length; i++) {
            var layer = targets[i];
            var timings = timingsById[layer.name];
            if (!timings) {
                // No precomputed timing (e.g. a hand-made layer): fall back to
                // the layer's own duration with the default fractions. Kept
                // conservative so it can never exceed half the layer.
                var duration = layer.outPoint - layer.inPoint;
                var inDur = Math.min(Math.max(duration * 0.25, 0.1), 0.45);
                inDur = Math.min(inDur, duration * 0.5);
                var outDur = Math.min(Math.max(duration * 0.2, 0.08), 0.35);
                outDur = Math.min(outDur, duration * 0.4);
                timings = {
                    inStart: 0,
                    inDuration: inDur,
                    outStart: duration - outDur,
                    outDuration: outDur
                };
            }
            capsetApplyAnimation(layer, animation, timings);
            changed++;
        }

        return capsetOk({ changed: changed });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

function capsetClearAnimations(scopeJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(scopeJson || "{}");
        var comp = capsetActiveComp();

        app.beginUndoGroup("Capset: clear animations");
        undoOpen = true;

        var cleared = 0;
        var layers = payload.scope === "all" ? null : comp.selectedLayers;
        if (layers === null) {
            for (var i = 1; i <= comp.numLayers; i++) {
                var candidate = comp.layer(i);
                if (candidate instanceof TextLayer && capsetIsCapsetLayer(candidate)) {
                    cleared += capsetRemoveAnimators(candidate) > 0 ? 1 : 0;
                }
            }
        } else {
            for (var j = 0; j < layers.length; j++) {
                if (layers[j] instanceof TextLayer) {
                    cleared += capsetRemoveAnimators(layers[j]) > 0 ? 1 : 0;
                }
            }
        }
        return capsetOk({ cleared: cleared });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}
