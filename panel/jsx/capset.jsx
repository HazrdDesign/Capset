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
    // Font, size and colour are NOT set here. comp.layers.addText() inherits
    // After Effects' current Character panel settings, so whatever the user
    // last used carries straight through. Forcing values would override the
    // look they just dialled in, and the Update tab exists to push a chosen
    // style everywhere afterwards.
    var prop = layer.property("Source Text");
    var doc = prop.value;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    prop.setValue(doc);

    // Title-safe: broadcast practice keeps captions inside the inner 80% of
    // frame, because overscan on real displays clips the edges.
    var baseline = style.titleSafe ? 0.80 : 0.88;
    if (style.positionY !== undefined && style.positionY !== null) {
        baseline = style.positionY;
    }
    layer.property("Transform").property("Position").setValue(
        [comp.width * 0.5, comp.height * baseline]
    );
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
// audio
//
// After Effects renders the audio; Capset does not read source files. That is
// both simpler and more correct: rendering yields what the user actually
// hears — the comp mix, levels, solo and mute states, audio effects, time
// remapping, nested comps — rather than whatever happens to sit inside one
// footage file. It also removes any need to bundle a media decoder.
//
// The backend reads the uncompressed WAV or AIFF this produces directly.
// ---------------------------------------------------------------------------

function capsetHasAudio(layer) {
    try {
        return layer.hasAudio === true;
    } catch (e) {
        return false;
    }
}

/** Audio-bearing layers that will actually contribute to the render. */
function capsetAudibleLayers(comp) {
    var audible = [];
    var soloed = false;
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).solo) { soloed = true; break; }
    }
    for (i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (!capsetHasAudio(layer)) continue;
        if (!layer.enabled && !layer.solo) continue;
        // A solo anywhere in the comp silences every non-soloed layer.
        if (soloed && !layer.solo) continue;
        audible.push(layer.name);
    }
    return audible;
}

/**
 * Pick an output module template that produces uncompressed audio.
 *
 * A template MUST be used. The output module's Format property is read-only
 * to scripting — setSettings() rejects it with "Invalid Value for key:
 * <Format>. Property is read-only" — so applyTemplate is the only way to
 * change what AE writes. Setting the file extension alone does not change
 * the format.
 *
 * Names are searched rather than guessed, because they differ by After
 * Effects version and locale. WAV is tried first, but note that AE's stock
 * templates include "AIFF 48kHz" and may not include WAV at all, so AIFF is
 * a likely outcome rather than an edge case. app/audio.py reads both.
 */
function capsetFindAudioTemplate(outputModule) {
    var available;
    try {
        available = outputModule.templates;
    } catch (e) {
        return null;
    }
    if (!available || !available.length) return null;

    var patterns = [/wav/i, /aif/i, /audio/i];
    for (var p = 0; p < patterns.length; p++) {
        for (var i = 0; i < available.length; i++) {
            if (patterns[p].test(available[i])) {
                return { name: available[i], extension: p === 1 ? ".aif" : ".wav" };
            }
        }
    }
    return null;
}

/**
 * @param payloadJson {scope: "composition"|"inout"}
 * @returns {path, start, duration, layers}
 */
function capsetRenderAudio(payloadJson) {
    var undoOpen = false;
    var comp = null;
    var savedStart = null;
    var savedDuration = null;
    var item = null;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        comp = capsetActiveComp();

        var audible = capsetAudibleLayers(comp);
        if (!audible.length) {
            throw new Error(
                "No audible audio in this composition. Check that the audio " +
                "layer is enabled and not muted by another layer's solo."
            );
        }

        var start = 0;
        var duration = comp.duration;
        if (payload.scope === "inout") {
            start = comp.workAreaStart;
            duration = comp.workAreaDuration;
        }

        app.beginUndoGroup("Capset: render audio");
        undoOpen = true;

        // Constrain the render via the work area, then restore it — silently
        // moving a user's work area would be rude and hard to notice.
        savedStart = comp.workAreaStart;
        savedDuration = comp.workAreaDuration;
        if (payload.scope !== "inout") {
            comp.workAreaStart = 0;
            comp.workAreaDuration = comp.duration;
        }

        item = app.project.renderQueue.items.add(comp);
        item.render = true;

        var om = item.outputModule(1);
        var template = capsetFindAudioTemplate(om);
        if (!template) {
            throw new Error(
                "No audio output module template was found in this copy of " +
                "After Effects. Create one: open the Render Queue, click an " +
                "Output Module, set Format to WAV or AIFF, then save it as a " +
                "template with \"WAV\" or \"AIFF\" in the name."
            );
        }
        om.applyTemplate(template.name);

        var target = new File(
            Folder.temp.fsName + "/capset_" + new Date().getTime() + template.extension
        );
        om.file = target;

        app.project.renderQueue.render();

        // AE appends its own extension when the template disagrees with the
        // filename, so accept whichever of the two actually landed.
        var produced = target;
        if (!produced.exists) {
            var alternates = [".wav", ".aif", ".aiff"];
            for (var a = 0; a < alternates.length; a++) {
                var candidate = new File(
                    target.fsName.replace(/\.[^.\\/]+$/, "") + alternates[a]
                );
                if (candidate.exists) { produced = candidate; break; }
            }
        }
        if (!produced.exists) {
            throw new Error(
                "The audio render produced no file. Check the Render Queue " +
                "for an error."
            );
        }

        return capsetOk({
            path: produced.fsName,
            start: start,
            duration: duration,
            template: template.name,
            layers: audible
        });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (item !== null) {
            try { item.remove(); } catch (e) {}
        }
        if (comp && savedStart !== null) {
            try {
                comp.workAreaStart = savedStart;
                comp.workAreaDuration = savedDuration;
            } catch (e) {}
        }
        if (undoOpen) app.endUndoGroup();
    }
}

// ---------------------------------------------------------------------------
// controller rig
//
// One null layer every caption is expression-linked to, so font size, colour
// and baseline update everywhere at once while each layer stays individually
// editable. This is the original project differentiator: Captioneer requires
// restyling every layer by hand.
//
// Font size and fill colour are driven through Source Text, which needs the
// JavaScript expression engine (AE 16.0+). Position is driven through
// Transform, which works on any engine, so a project stuck on the legacy
// engine still gets baseline control rather than nothing.
// ---------------------------------------------------------------------------

function capsetUsesJsEngine() {
    try {
        return String(app.project.expressionEngine).indexOf("javascript") === 0;
    } catch (e) {
        return false; // pre-16.0 has no expressionEngine property at all
    }
}

function capsetFindController(comp) {
    for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === CAPSET_CONTROLLER) return comp.layer(i);
    }
    return null;
}

function capsetEnsureController(comp, style) {
    var existing = capsetFindController(comp);
    if (existing) return existing;

    var controller = comp.layers.addNull();
    controller.name = CAPSET_CONTROLLER;
    controller.enabled = false;      // never renders
    controller.shy = true;
    controller.moveToBeginning();

    var effects = controller.property("ADBE Effect Parade");

    var fontSize = effects.addProperty("ADBE Slider Control");
    fontSize.name = "Font Size";
    fontSize.property("ADBE Slider Control-0001").setValue(
        style && style.fontSize ? style.fontSize : 72
    );

    var baseline = effects.addProperty("ADBE Slider Control");
    baseline.name = "Baseline %";
    baseline.property("ADBE Slider Control-0001").setValue(
        style && style.positionY !== undefined ? style.positionY * 100 : 82
    );

    var fill = effects.addProperty("ADBE Color Control");
    fill.name = "Fill Colour";
    fill.property("ADBE Color Control-0001").setValue(
        style && style.fillColor ? style.fillColor.concat([1]) : [1, 1, 1, 1]
    );

    return controller;
}

/**
 * Link a caption layer to the controller.
 *
 * Expressions are wrapped in try/catch: an expression that errors disables
 * itself in AE and leaves a red layer, which is a far worse outcome than
 * silently falling back to the layer's own value.
 */
function capsetLinkToController(layer, useJsEngine) {
    var position = layer.property("Transform").property("Position");
    position.expression =
        'var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        'try {\r' +
        '  [thisComp.width / 2, thisComp.height * c.effect("Baseline %")("Slider") / 100];\r' +
        '} catch (err) { value; }';

    if (!useJsEngine) return false;

    var sourceText = layer.property("Source Text");
    sourceText.expression =
        'var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        'var t = value;\r' +
        'try {\r' +
        '  t.fontSize = c.effect("Font Size")("Slider");\r' +
        '  t.fillColor = c.effect("Fill Colour")("Color");\r' +
        '} catch (err) {}\r' +
        't;';
    return true;
}

function capsetBuildController(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var comp = capsetActiveComp();

        app.beginUndoGroup("Capset: build controller");
        undoOpen = true;

        var controller = capsetEnsureController(comp, payload.style || {});
        var useJs = capsetUsesJsEngine();

        var linked = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer instanceof TextLayer && capsetIsCapsetLayer(layer)) {
                capsetLinkToController(layer, useJs);
                linked++;
            }
        }

        return capsetOk({
            linked: linked,
            controllerIndex: controller.index,
            styleLinked: useJs,
            note: useJs
                ? null
                : "Legacy expression engine: only the baseline is linked. " +
                  "Switch to JavaScript in File > Project Settings > Expressions " +
                  "for font size and colour."
        });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

// ---------------------------------------------------------------------------
// style capture and sync
//
// Workflow this supports: generate captions, restyle ONE layer by hand in the
// Character panel until it looks right, then push that look onto every other
// caption -- in this comp or across the whole project. Effects come along
// too, so a glow or stroke applied to the sample layer propagates as well.
// ---------------------------------------------------------------------------

function capsetTextLayers(comp, capsetOnly) {
    var found = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer instanceof TextLayer) {
            if (!capsetOnly || capsetIsCapsetLayer(layer)) found.push(layer);
        }
    }
    return found;
}

function capsetAllComps() {
    var comps = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem) comps.push(item);
    }
    return comps;
}

/** Snapshot the styling of the selected text layer. */
function capsetCaptureStyle() {
    try {
        var comp = capsetActiveComp();
        var selected = comp.selectedLayers;
        var source = null;
        for (var i = 0; i < selected.length; i++) {
            if (selected[i] instanceof TextLayer) { source = selected[i]; break; }
        }
        if (!source) throw new Error("Select a styled text layer first.");

        var doc = source.property("Source Text").value;
        var style = {
            font: doc.font,
            fontSize: doc.fontSize,
            tracking: doc.tracking,
            justification: doc.justification,
            applyFill: doc.applyFill,
            applyStroke: doc.applyStroke,
            strokeWidth: doc.strokeWidth,
            strokeOverFill: doc.strokeOverFill,
            leading: doc.leading
        };
        try { style.fillColor = doc.fillColor; } catch (e) {}
        try { style.strokeColor = doc.strokeColor; } catch (e) {}
        try { style.position = source.property("Transform").property("Position").value; } catch (e) {}
        try { style.scale = source.property("Transform").property("Scale").value; } catch (e) {}

        // Effect names only. Values are copied layer-to-layer at apply time,
        // because serialising arbitrary effect parameters through JSON loses
        // types AE cares about.
        var effects = [];
        var parade = source.property("ADBE Effect Parade");
        for (var e2 = 1; e2 <= parade.numProperties; e2++) {
            effects.push({
                name: parade.property(e2).name,
                matchName: parade.property(e2).matchName
            });
        }

        return capsetOk({
            sourceLayerName: source.name,
            sourceCompName: comp.name,
            sourceLayerIndex: source.index,
            style: style,
            effects: effects,
            effectCount: effects.length
        });
    } catch (e) {
        return capsetErr(e.message);
    }
}

function capsetApplyStyleToLayer(layer, style, comp) {
    var prop = layer.property("Source Text");
    var doc = prop.value;

    if (style.font) doc.font = style.font;
    if (style.fontSize) doc.fontSize = style.fontSize;
    if (style.tracking !== undefined) doc.tracking = style.tracking;
    if (style.leading !== undefined && style.leading !== null) {
        try { doc.leading = style.leading; } catch (e) {}
    }
    if (style.justification !== undefined) doc.justification = style.justification;
    if (style.applyFill !== undefined) doc.applyFill = style.applyFill;
    if (style.fillColor) { try { doc.fillColor = style.fillColor; } catch (e) {} }
    if (style.applyStroke !== undefined) doc.applyStroke = style.applyStroke;
    if (style.strokeColor) { try { doc.strokeColor = style.strokeColor; } catch (e) {} }
    if (style.strokeWidth !== undefined) doc.strokeWidth = style.strokeWidth;
    if (style.strokeOverFill !== undefined) doc.strokeOverFill = style.strokeOverFill;
    prop.setValue(doc);

    // Position is proportional, not absolute: the sample layer may come from a
    // comp of a different size, and copying raw pixels would drop captions off
    // the edge of a differently-shaped comp.
    if (style.position && style.sourceWidth && style.sourceHeight) {
        try {
            layer.property("Transform").property("Position").setValue([
                comp.width * (style.position[0] / style.sourceWidth),
                comp.height * (style.position[1] / style.sourceHeight)
            ]);
        } catch (e) {}
    }
    if (style.scale) {
        try { layer.property("Transform").property("Scale").setValue(style.scale); } catch (e) {}
    }
}

/** Copy effects from a source layer onto a target, replacing any Capset added. */
function capsetCopyEffects(sourceLayer, targetLayer) {
    var targetParade = targetLayer.property("ADBE Effect Parade");
    for (var i = targetParade.numProperties; i >= 1; i--) {
        try { targetParade.property(i).remove(); } catch (e) {}
    }
    var sourceParade = sourceLayer.property("ADBE Effect Parade");
    var copied = 0;
    for (var j = 1; j <= sourceParade.numProperties; j++) {
        var effect = sourceParade.property(j);
        try {
            effect.selected = true;
            copied++;
        } catch (e) {}
    }
    if (copied) {
        try {
            // AE has no scripting API for duplicating an effect with its
            // values, so the copy/paste commands are the only route.
            app.executeCommand(app.findMenuCommandId("Copy"));
            targetLayer.selected = true;
            app.executeCommand(app.findMenuCommandId("Paste"));
        } catch (e) {
            return 0;
        }
    }
    return copied;
}

/**
 * @param payloadJson {style, effects, copyEffects, scope: "comp"|"project",
 *                     sourceLayerIndex, sourceCompName}
 */
function capsetSyncStyle(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var style = payload.style;
        if (!style) throw new Error("No captured style to apply.");

        var scope = payload.scope || "comp";
        var comps = scope === "project" ? capsetAllComps() : [capsetActiveComp()];

        app.beginUndoGroup("Capset: sync caption style");
        undoOpen = true;

        var updated = 0;
        var compsTouched = 0;
        for (var c = 0; c < comps.length; c++) {
            var comp = comps[c];
            var layers = capsetTextLayers(comp, true);
            if (!layers.length) continue;
            compsTouched++;
            for (var i = 0; i < layers.length; i++) {
                capsetApplyStyleToLayer(layers[i], style, comp);
                updated++;
            }
        }

        if (!updated) {
            throw new Error(
                scope === "project"
                    ? "No Capset caption layers found in this project."
                    : "No Capset caption layers in this composition."
            );
        }

        return capsetOk({
            updated: updated,
            comps: compsTouched,
            scope: scope
        });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

/** Remove every Capset caption layer, so a rebuild replaces rather than stacks. */
function capsetClearCaptions(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var comp = capsetActiveComp();

        app.beginUndoGroup("Capset: clear captions");
        undoOpen = true;

        var removed = 0;
        for (var i = comp.numLayers; i >= 1; i--) {
            var layer = comp.layer(i);
            if (capsetIsCapsetLayer(layer) && layer.name !== CAPSET_CONTROLLER) {
                layer.remove();
                removed++;
            }
        }
        if (payload.removeController !== false) {
            var controller = capsetFindController(comp);
            if (controller) { controller.remove(); removed++; }
        }
        return capsetOk({ removed: removed });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function capsetBuildCaptions(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var captions = payload.captions || [];
        var style = payload.style || {};
        var animation = payload.animation || null;
        var offset = payload.timeOffset || 0;
        var options = payload.options || {};

        if (!captions.length) throw new Error("No captions to build.");

        var comp = capsetActiveComp();

        app.beginUndoGroup("Capset: add captions");
        undoOpen = true;

        // Rebuilding replaces rather than stacks: running Add Captions twice
        // should not leave two sets of layers fighting over the same frames.
        var replaced = 0;
        for (var r = comp.numLayers; r >= 1; r--) {
            var existing = comp.layer(r);
            if (capsetIsCapsetLayer(existing) && existing.name !== CAPSET_CONTROLLER) {
                existing.remove();
                replaced++;
            }
        }

        var controller = null;
        if (options.parentToController) {
            controller = capsetEnsureController(comp, style);
        }

        var created = [];
        var i;
        for (i = 0; i < captions.length; i++) {
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
            if (controller) {
                try { layer.parent = controller; } catch (e) {}
            }
            created.push(layer);
        }

        var precomposed = false;
        if (options.precompose && created.length) {
            var indices = [];
            for (i = 0; i < created.length; i++) indices.push(created[i].index);
            try {
                var pre = comp.layers.precompose(indices, "Capset Captions", true);
                pre.name = CAPSET_PREFIX + "captions";
                precomposed = true;
            } catch (e) {
                // Not fatal: the captions exist either way.
            }
        }

        return capsetOk({
            created: created.length,
            replaced: replaced,
            precomposed: precomposed,
            parented: controller !== null
        });
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
