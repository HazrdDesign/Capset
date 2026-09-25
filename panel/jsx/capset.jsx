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
 * STATUS: exercised by panel/tests/jsx-behaviour.test.js against the fake host
 * in panel/tests/fake-ae.js, which found four bugs that reading the file had
 * not. Still NOT run inside After Effects: match names, precompose semantics
 * and Character panel behaviour follow the scripting reference and remain
 * unverified against a real host.
 */

#include "json2.jsx"

var CAPSET_PREFIX = "Capset__";
var CAPSET_CONTROLLER = "Capset Controller";

// Written into every caption layer's comment field, and the primary way a
// Capset layer is recognised.
//
// The name used to carry that job (Capset__cap_1, Capset__cap_2...), which
// meant the timeline read like a list of serial numbers when it could have
// read like the transcript. The comment is invisible unless you turn the
// Comment column on, survives a rename, and leaves the name free to say what
// the caption actually says.
var CAPSET_TAG = "Capset caption";

// Exported subtitles go in a folder of their own beside the project file, so
// an export never drops a loose file into someone's project directory.
var CAPSET_SRT_FOLDER = "Capset SRT";

// Where a caption sits vertically, as a fraction of comp height: the subtitle
// band on 16:9 and 9:16 alike. One constant, because the controller rig's
// "Baseline %" slider must start where the layers already are -- it defaulted
// to 82 while the layers were built at 85, so merely parenting them to the
// controller nudged every caption up.
var CAPSET_BASELINE = 0.85;

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
/**
 * Whitespace-trim a string.
 *
 * String.prototype.trim is ES5 and ExtendScript is ES3, so it is not there --
 * and panel/tests/jsx.test.js bans it outright, because reaching for it does
 * not fail loudly at the call site, it fails at PARSE time and takes the whole
 * file with it.
 */
function capsetTrim(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/^\s+/, "").replace(/\s+$/, "");
}

function capsetSnap(comp, seconds) {
    if (!comp.frameDuration) return seconds;
    return Math.round(seconds / comp.frameDuration) * comp.frameDuration;
}

// ---------------------------------------------------------------------------
// backend discovery
// ---------------------------------------------------------------------------

/*
 * Where the backend publishes the port it actually bound to.
 *
 * Must stay in step with logging_setup.data_dir() in the backend, which
 * writes config.PORT_FILE_NAME there. The two runtimes cannot share
 * constants, so the path is spelled out twice; tests on both sides pin the
 * shape so a drift fails a build instead of producing a panel that cannot
 * find a service that is running perfectly well.
 *
 *   Windows  %LOCALAPPDATA%\Capset\port
 *   macOS    ~/Library/Application Support/Capset/port
 */
function capsetUserDataDir() {
    if ($.os.indexOf("Windows") !== -1) {
        var local = $.getenv("LOCALAPPDATA");
        if (!local) return null;
        return local + "\\Capset";
    }
    // Folder("~/...") expands the home directory on macOS; fsName gives the
    // platform path File() wants.
    return Folder("~/Library/Application Support/Capset").fsName;
}

function capsetJoin(dir, name) {
    if (!dir) return null;
    return dir + ($.os.indexOf("Windows") !== -1 ? "\\" : "/") + name;
}

function capsetPortFile() {
    return capsetJoin(capsetUserDataDir(), "port");
}

/**
 * The directory the panel may write to.
 *
 * Never the extension folder: it lives under Program Files, needs elevation,
 * and is replaced wholesale on every upgrade — saved presets would vanish
 * with the first update.
 */
/**
 * Delete a render Capset made, once the transcription is finished with it.
 *
 * Nothing used to delete these. Every transcription left a full-size
 * uncompressed WAV in the temp folder forever -- an hour of 48 kHz stereo is
 * about 690 MB, so a few podcasts quietly cost a user several gigabytes of
 * disk they had no reason to connect to a captioning plugin.
 *
 * Deliberately narrow about WHAT it will delete. The path now travels to the
 * backend and back, and a plugin that deletes whatever path it is handed is
 * one bug away from removing somebody's footage. So: it must be inside the
 * temp folder, and it must carry the name this plugin writes. Anything else
 * is refused, and a refusal is never an error the user has to care about --
 * the worst case is a temp file that stays a little longer.
 */
function capsetDiscardRender(payloadJson) {
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var path = payload && payload.path;
        if (!path) return capsetOk({ removed: false, reason: "no path" });

        var file = new File(path);
        if (!file.exists) return capsetOk({ removed: false, reason: "already gone" });

        var name = decodeURI(file.name);
        if (!/^capset_\d+\./.test(name)) {
            return capsetOk({ removed: false, reason: "not a Capset render" });
        }
        // fsName so both sides are platform paths; Folder.temp can be a
        // symlink target whose URI spelling differs from the file's.
        var temp = Folder.temp.fsName;
        var parent = file.parent ? file.parent.fsName : "";
        if (parent.toLowerCase() !== temp.toLowerCase()) {
            return capsetOk({ removed: false, reason: "not in the temp folder" });
        }

        return capsetOk({ removed: file.remove() === true });
    } catch (e) {
        // Cleanup must never be the thing that fails a run.
        return capsetOk({ removed: false, reason: e.message });
    }
}

function capsetGetUserDataDir() {
    try {
        var dir = capsetUserDataDir();
        if (!dir) return capsetErr("Could not locate a writable data folder.");
        var folder = Folder(dir);
        if (!folder.exists) folder.create();
        return capsetOk(dir);
    } catch (e) {
        return capsetErr(e.message);
    }
}

/**
 * Read the port the running backend published, or null.
 *
 * Panel JavaScript cannot read environment variables, so the host resolves
 * the path. Every failure returns null rather than an error: no file means
 * no backend has ever run here, which is the ordinary first-launch state,
 * and the panel simply falls back to the default port.
 */
function capsetBackendPort() {
    // Returns {port, token}, or null when nothing has been published. The
    // token is what proves a caller read this file: the service refuses /jobs
    // without it, because a web page on this machine can reach the service
    // but cannot read a file. See _require_token in backend/app/main.py.
    var file = null;
    try {
        var path = capsetPortFile();
        if (!path) return capsetOk(null);
        file = File(path);
        if (!file.exists) return capsetOk(null);
        if (!file.open("r")) return capsetOk(null);
        var text = String(file.read());
        file.close();
        file = null;
        // Port on the first line, token on the second. parseInt stops at the
        // newline, so this still reads a file written in the old one-line
        // format -- and the token is simply absent there.
        var lines = text.split(/[\r\n]+/);
        var port = parseInt(lines[0].replace(/^\s+|\s+$/g, ""), 10);
        if (isNaN(port) || port < 1 || port > 65535) return capsetOk(null);
        var token = lines.length > 1
            ? lines[1].replace(/^\s+|\s+$/g, "")
            : "";
        return capsetOk({ port: port, token: token });
    } catch (e) {
        // Discovery must never break the panel; the default port still works.
        if (file) { try { file.close(); } catch (ignored) {} }
        return capsetOk(null);
    }
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

    // Captions land centred, in the subtitle band, every time.
    //
    // This used to be a "Keep inside title-safe" checkbox choosing between
    // 0.80 and 0.88, and it did not do what the label promised: title-safe is
    // about the whole text BLOCK staying inside the inner 80% of frame, and
    // the block's size is whatever the user's Character panel settings make
    // it -- which is the entire point of inheriting them. Moving the anchor
    // up cannot keep type of an unknown size inside anything.
    //
    // 0.85 is the subtitle band itself: below the action of a 16:9 frame,
    // clear of the platform UI that crowds the bottom of a 9:16 one, and
    // clear of the frame edge on both. Anyone wanting it elsewhere moves the
    // layers, or restyles one and pushes it with the Update tab.
    var baseline = CAPSET_BASELINE;
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
    blur: "ADBE Text Blur",
    // Colour and tracking are what separate a CapCut-style caption from a
    // generic fade. addProperty is wrapped in try/catch below, so a host that
    // rejects one of these skips that property rather than failing the build.
    fillColor: "ADBE Text Fill Color",
    strokeColor: "ADBE Text Stroke Color",
    strokeWidth: "ADBE Text Stroke Width",
    tracking: "ADBE Text Tracking Amount"
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

/**
 * Read a from/to value out of an animation definition.
 *
 * Understands the token "$textColor", which resolves to the layer's OWN fill
 * colour. A colour flash has to settle on the colour the user actually chose:
 * hardcoding white in the definition would quietly overwrite the look they
 * dialled in through the Character panel, which is the one thing the styling
 * design is careful never to do.
 */
function capsetToValue(spec, key, layer) {
    var raw = spec[key];
    if (raw === "$textColor") {
        try {
            var colour = layer.property("Source Text").value.fillColor;
            if (colour && colour.length >= 3) {
                return [colour[0], colour[1], colour[2]];
            }
        } catch (e) {}
        return [1, 1, 1];   // white: the overwhelmingly common caption colour
    }
    if (raw instanceof Array) {
        return raw.length === 2 ? [raw[0], raw[1], 0] : raw;
    }
    return raw;
}

/**
 * The value a property passes through before settling.
 *
 * Overshoot is measured against the TRAVEL, not the target: scaling 40 -> 100
 * with overshoot 1.12 peaks at 107.2, and sliding -80 -> 0 with 1.25 peaks at
 * +20 before coming back. Multiplying the target instead would do nothing at
 * all whenever the target is zero, which is every position animation.
 *
 * This is what makes a caption feel like CapCut rather than a fade. The field
 * was in the animation definitions from the start and nothing read it, so
 * every "pop" and "bounce" in the library was a plain interpolation.
 */
function capsetOvershootValue(from, to, overshoot) {
    var extra = overshoot - 1;
    if (to instanceof Array) {
        var peaked = [];
        for (var i = 0; i < to.length; i++) {
            var start = (from instanceof Array) ? from[i] : from;
            peaked.push(to[i] + (to[i] - start) * extra);
        }
        return peaked;
    }
    return to + (to - from) * extra;
}

/**
 * The overshoot keys for a property, as a decaying oscillation.
 *
 * A single overshoot key gets you past the target and back, but the motion
 * arrives at the peak and leaves it at a constant speed -- a corner in the
 * velocity curve, which reads as a hitch rather than a spring. Real short-form
 * captions settle: they pass the target, come back short of it, and converge.
 * Breakdowns of the style consistently name exactly this as the difference
 * between amateur and professional text animation.
 *
 * `bounces` is how many times it crosses the target, `damping` how much
 * amplitude survives each crossing (0.5 halves it). One bounce with no damping
 * is the old single-overshoot behaviour, so existing definitions are unchanged.
 *
 * Returns [{ at: 0..1 through the phase, value: ... }], settling key excluded.
 */
function capsetSpringKeys(from, to, overshoot, bounces, damping) {
    var keys = [];
    if (!(overshoot > 1)) return keys;

    var count = bounces > 0 ? Math.floor(bounces) : 1;
    if (count > 4) count = 4;             // beyond this it reads as a wobble
    var decay = (damping > 0 && damping < 1) ? damping : 0.5;

    // The first peak lands at 65% of the phase: far enough in to read as a
    // punch, with enough left afterwards for the settle to be visible.
    var firstAt = 0.65;
    var amplitude = overshoot - 1;

    for (var i = 0; i < count; i++) {
        // Alternate sides of the target, shrinking each time.
        var signed = 1 + amplitude * (i % 2 === 0 ? 1 : -1);
        var at = firstAt + (1 - firstAt) * (i / (count + 1));
        keys.push({ at: at, value: capsetOvershootValue(from, to, signed) });
        amplitude *= decay;
    }
    return keys;
}

/**
 * Build one animator phase.
 *
 * HOW A RANGE SELECTOR ACTUALLY WORKS, because getting this wrong shipped a
 * build whose entrances barely moved:
 *
 * A range selector does NOT delay the animation per character. It scales HOW
 * MUCH of the animator reaches each character -- Adobe's wording is "At 0%,
 * the animator properties do not affect the characters." So the selector has
 * to be animated from FULLY COVERING the text (the animator's pose applies to
 * everything) to COVERING NOTHING (every character sits at its natural pose),
 * and the stagger is the edge of that range travelling across the text.
 *
 * This previously swept Offset from -100 to +100 with Start/End left at
 * 0/100. That covers nothing at -100, everything at 0, and nothing again at
 * +100 -- so coverage went 0% -> 100% -> 0% and the character sat at its
 * natural pose at BOTH ends of every phase. A scale entrance never started
 * small and an opacity entrance never faded in; the keyframes were real and
 * nothing read them. Animating Start instead sweeps the range's leading edge
 * across the text, which is the canonical construction.
 *
 * @param layer       the text layer
 * @param name        animator name (prefixed)
 * @param phase       animation definition's in/out block
 * @param startTime   absolute comp time the phase begins
 * @param duration    phase length in seconds
 * @param basedOn     "characters" | "words" | ... - the stagger unit
 * @param reverse     true for the out phase, which travels the other way:
 *                    an exit ENDS in its pose rather than starting in it
 */
function capsetAddPhase(layer, name, phase, startTime, duration, basedOn, reverse) {
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

        var from = capsetToValue(spec, "from", layer);
        var to = capsetToValue(spec, "to", layer);

        prop.setValueAtTime(startTime, from);
        var overshoot = Number(spec.overshoot);
        var springKeys = duration > 0
            ? capsetSpringKeys(from, to, overshoot, Number(spec.bounces),
                               Number(spec.damping))
            : [];
        var overshot = springKeys.length > 0;
        for (var k = 0; k < springKeys.length; k++) {
            prop.setValueAtTime(
                startTime + duration * springKeys[k].at, springKeys[k].value
            );
        }
        prop.setValueAtTime(startTime + duration, to);

        // Ease both keys. KeyframeEase(speed, influence); influence is the
        // percentage that gives the curve its shape.
        try {
            var n = prop.numKeys;
            var dims = (from instanceof Array) ? from.length : 1;
            // Ease the FIRST and LAST keys only. The spring keys between them
            // are deliberately left linear: easing a peak would stop the
            // motion dead at the top of the bounce, and the whole point of the
            // oscillation is that it carries through. (This used to be
            // computed as n - 2, which only ever meant "the first key" back
            // when there was exactly one overshoot key.)
            var firstKey = 1;
            var inEase = [];
            var outEase = [];
            for (var d = 0; d < dims; d++) {
                inEase.push(new KeyframeEase(0, easeIn));
                outEase.push(new KeyframeEase(0, easeOut));
            }
            if (dims === 1) {
                prop.setTemporalEaseAtKey(firstKey, [inEase[0]], [outEase[0]]);
                prop.setTemporalEaseAtKey(n, [inEase[0]], [outEase[0]]);
            } else {
                prop.setTemporalEaseAtKey(firstKey, inEase, outEase);
                prop.setTemporalEaseAtKey(n, inEase, outEase);
            }
        } catch (e) {
            // Easing is cosmetic; linear keys are still a working animation.
        }
    }

    // Sweep the range's leading edge across the text. Start at 0 with End at
    // 100 covers everything, so every unit begins fully in the animator's
    // pose; driving Start to 100 retreats the range off the end of the text,
    // resolving units to their natural pose one after another. An exit runs
    // the same sweep backwards, so it ENDS in its pose instead of starting
    // there. See the note on this function.
    try {
        var startProp = selector.property("ADBE Text Percent Start");
        startProp.setValueAtTime(startTime, reverse ? 100 : 0);
        startProp.setValueAtTime(startTime + duration, reverse ? 0 : 100);
    } catch (e) {
        // A host without this property still animates, just without stagger,
        // and every unit takes the animator's full pose for the phase --
        // which is the whole animation, not nothing. Better than the reverse.
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
            timings.inDuration, basedOn, false
        )) applied++;
    }

    if (timings.outDuration > 0 && animation.out) {
        if (capsetAddPhase(
            layer, CAPSET_PREFIX + animation.id + "__out",
            animation.out, layer.inPoint + timings.outStart,
            timings.outDuration, basedOn, true
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

/** Audio-bearing layers the user has selected, if any. */
function capsetSelectedAudioLayers(comp) {
    var chosen = [];
    var selected = comp.selectedLayers;
    for (var i = 0; i < selected.length; i++) {
        if (capsetHasAudio(selected[i])) chosen.push(selected[i]);
    }
    return chosen;
}

/**
 * Solo exactly the given layers for the duration of a render.
 *
 * Selecting the voiceover layer and pressing Add Captions should transcribe
 * the voiceover, not the voiceover plus the music bed — mixing music into the
 * input costs real accuracy, and the workflow the plugin is built around is
 * "select the audio layer, hit the button". Soloing is how After Effects
 * expresses that, and it is restored afterwards.
 *
 * Returns the previous solo state of every layer, for capsetRestoreSolo.
 */
function capsetSoloOnly(comp, layers) {
    var saved = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        var wanted = false;
        for (var j = 0; j < layers.length; j++) {
            if (layers[j] === layer) { wanted = true; break; }
        }
        try {
            saved.push({ layer: layer, solo: layer.solo });
            if (layer.solo !== wanted) layer.solo = wanted;
        } catch (e) {
            // Some layer types refuse solo; leaving them as they are is fine.
        }
    }
    return saved;
}

function capsetRestoreSolo(saved) {
    if (!saved) return;
    for (var i = 0; i < saved.length; i++) {
        try { saved[i].layer.solo = saved[i].solo; } catch (e) {}
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
/**
 * Re-read an output module after its settings have been changed.
 *
 * After Effects invalidates the OutputModule object when a setting is
 * modified -- applyTemplate() and setSetting() both count -- so a reference
 * taken beforehand is stale, and assigning `.file` on a stale one sends the
 * render somewhere we never look for it. Adobe's scripting reference
 * documents this as a bug and says to retrieve the module again.
 *
 * Falls back to the caller's reference: a host where this fails is still
 * better served by the old object than by nothing.
 */
function capsetRefetchOutputModule(item, fallback) {
    try {
        return item.outputModule(1) || fallback;
    } catch (e) {
        return fallback;
    }
}

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
                return {
                    name: available[i],
                    extension: capsetTemplateExtension(available[i])
                };
            }
        }
    }
    return null;
}

/**
 * Guess a template's file extension from its own name.
 *
 * Derived from the NAME, not from which pattern matched it: the generic
 * /audio/i fallback used to hand back ".wav" for anything it matched, so a
 * stock "Audio Only" template that writes AIFF was named .wav. The magic-byte
 * sniffing in the backend and the alternates loop in capsetRenderAudio both
 * cover the mismatch, but guessing right means neither has to.
 */
function capsetTemplateExtension(name) {
    if (/aif/i.test(name)) return ".aif";
    return ".wav";
}

/**
 * Disable every other queued item so render() renders only ours.
 *
 * renderQueue.render() renders EVERY item whose render flag is set, not the
 * one you just added. Without this, hitting Add Captions while the user had
 * a delivery queued would start that delivery: hours of machine time, and
 * their output file overwritten, from a button that says "Add Captions".
 *
 * Returns the items that were switched off, for the caller to restore.
 */
function capsetSuspendQueue(ourItem) {
    var suspended = [];
    var queue;
    try {
        queue = app.project.renderQueue;
    } catch (e) {
        return suspended;
    }
    for (var i = 1; i <= queue.numItems; i++) {
        var queued;
        try {
            queued = queue.item(i);
        } catch (e) {
            continue;
        }
        if (queued === ourItem) continue;
        try {
            // Items already rendered refuse the assignment; that is fine,
            // they will not render again anyway.
            if (queued.render) {
                queued.render = false;
                suspended.push(queued);
            }
        } catch (e) {}
    }
    return suspended;
}

function capsetResumeQueue(suspended) {
    for (var i = 0; i < suspended.length; i++) {
        try { suspended[i].render = true; } catch (e) {}
    }
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
    var suspended = [];
    var soloRestore = null;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        comp = capsetActiveComp();

        // Selection wins when there is one. Everything the user can hear is
        // the sensible default, but it is a default, not a rule: with a music
        // bed under a voiceover it transcribes both and accuracy suffers.
        var chosen = capsetSelectedAudioLayers(comp);
        if (chosen.length) {
            soloRestore = capsetSoloOnly(comp, chosen);
        }

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
        om = capsetRefetchOutputModule(item, om);

        // Ask for audio explicitly. A render that writes a valid file with no
        // samples in it is the failure this is guarding against, and it is
        // invisible until a transcription comes back empty.
        //
        // Confidence here is lower than the rest of this function: the key is
        // documented by the community as "Output Audio" on the OUTPUT MODULE
        // (values "On"/"Off"/"Auto"), not in Adobe's own reference, and
        // setSetting itself only exists from CC 2014. A wrong key throws,
        // which is why this is wrapped and advisory -- if it does not take, we
        // still catch the empty file below rather than shipping silence.
        try {
            om.setSetting("Output Audio", "On");
            om = capsetRefetchOutputModule(item, om);
        } catch (e) {
            // Older host, different key, or a format with no audio switch.
        }

        var target = new File(
            Folder.temp.fsName + "/capset_" + new Date().getTime() + template.extension
        );
        om.file = target;

        // Only ours. See capsetSuspendQueue.
        suspended = capsetSuspendQueue(item);

        // Close our undo group BEFORE rendering, and do not hold one across
        // the render.
        //
        // After Effects does its own undo bookkeeping while the render queue
        // runs. A script group held open across it comes back unbalanced, and
        // the host then says "Undo group mismatch, will attempt to fix" --
        // not at render time, but the next time the user does something
        // undoable, so it surfaces as a warning when they nudge a caption
        // layer and reads like the captions broke something.
        if (undoOpen) {
            app.endUndoGroup();
            undoOpen = false;
        }

        app.project.renderQueue.render();

        // AE appends its own extension when the template disagrees with the
        // filename, so accept whichever of the two actually landed.
        var produced = target;
        if (!produced.exists) {
            var alternates = [".wav", ".aif", ".aiff"];
            for (var a = 0; a < alternates.length; a++) {
                var candidate = new File(
                    target.fsName.replace(/\.[^.\\\/]+$/, "") + alternates[a]
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

        // Catch a failed render HERE, before uploading it and waiting for a
        // transcription to come back empty. A WAV header alone is 44 bytes,
        // and an AIFF header is smaller than 128, so anything at or under
        // that carries no samples at all -- which is what a render with audio
        // switched off produces. A real user lost an evening to this arriving
        // as "0 words" several steps downstream.
        var bytes = 0;
        try { bytes = produced.length; } catch (e) { bytes = 0; }
        if (bytes > 0 && bytes <= 128) {
            throw new Error(
                "After Effects rendered an empty audio file (" + bytes +
                " bytes) — a header with no sound in it. Audio output is " +
                "switched off somewhere in the render: open the Render Queue " +
                "and check both the Output Module (Audio Output should be on) " +
                "and Render Settings, then try again."
            );
        }

        return capsetOk({
            path: produced.fsName,
            start: start,
            duration: duration,
            template: template.name,
            layers: audible,
            // Surfaced so the panel can say how much audio it actually got
            // before it uploads. An implausibly small file for the requested
            // duration is the earliest visible sign of a silent render.
            bytes: bytes,
            // So the panel can say WHAT it transcribed. Getting captions for
            // the wrong layer with no indication of which one was used is a
            // confusing failure to debug.
            fromSelection: chosen.length > 0
        });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        // The setup group is normally already closed by this point -- it is
        // shut before the render. It is still open only when something threw
        // on the way there, and the teardown below belongs in a group of its
        // own either way: these are the changes worth being one undo step,
        // and putting them in the setup group would mean holding that group
        // across the render again.
        if (undoOpen) {
            app.endUndoGroup();
            undoOpen = false;
        }
        app.beginUndoGroup("Capset: restore after render");
        try {
            // Restore before anything else: leaving a user's queue disabled
            // is a silent failure they would discover hours later, when the
            // render they set going overnight turns out not to have run.
            capsetResumeQueue(suspended);
            capsetRestoreSolo(soloRestore);
            if (item !== null) {
                try { item.remove(); } catch (e) {}
            }
            if (comp && savedStart !== null) {
                try {
                    comp.workAreaStart = savedStart;
                    comp.workAreaDuration = savedDuration;
                } catch (e) {}
            }
        } finally {
            app.endUndoGroup();
        }
    }
}

// ---------------------------------------------------------------------------
// controller rig
//
// One null layer every caption is expression-linked to, so type, layout and
// visibility update everywhere at once while each layer stays individually
// editable. This is the original project differentiator: Captioneer requires
// restyling every layer by hand.
//
// Font Size, Fill Color, Stroke, Tracking, Leading and All Caps are driven
// through Source Text via the Text Style expression API, which needs the
// JavaScript expression engine (AE 17.0+) -- see the citations above the
// expression in capsetLinkToController for exactly what was verified.
// Position and Opacity are driven through Transform with ordinary property
// references, which work on any engine, so a project stuck on the legacy
// engine still gets baseline, horizontal position, global opacity and fades
// rather than nothing. Drop Shadow is a per-caption effect rather than a
// Source Text style, so it too works on either engine.
//
// capsetControllerEffectSpecs is the single source of truth for what the rig
// carries: name, AAE effect type, and default value. Both a brand new
// controller and an upgrade of an existing one (capsetUpgradeControllerEffects)
// are built from the same list, so the two can never drift apart.
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

/**
 * What the controller rig carries: name, effect match name, and a default
 * value function. This is read by three places -- building a brand new
 * controller, upgrading an existing one, and Sync Style writing into a
 * controller's effects -- so all three agree on names and defaults by
 * construction rather than by three copies staying in sync by hand.
 *
 * Grouped Text / Layout / Visibility / Shadow, in the order they are meant
 * to read in the Effect Controls panel.
 *
 * Defaults here are the FALLBACK used when there is no better source: an
 * upgrade adding an effect a legacy controller never had, or Sync Style
 * seeding one from a captured style. They are chosen to change nothing where
 * there is no evidence to the contrary -- stroke, fades and the shadow off,
 * tracking untouched, leading auto, fill on, horizontal position centred.
 *
 * A brand new controller is seeded from something better: the actual
 * TextDocument of the first caption layer just created, i.e. whatever the
 * Character panel was already set to (see capsetSeedControllerFromDoc,
 * called once from capsetBuildCaptions right after that layer exists). These
 * specs' own `value()` is what that controller starts with for the instant
 * before the doc-based seed overwrites it, and is what an EXISTING
 * controller's newly-added effects get instead, since re-seeding a
 * controller the user already has would overwrite sliders that are theirs,
 * not Capset's, to change.
 */
function capsetControllerEffectSpecs(style) {
    return [
        // --- text ------------------------------------------------------------
        {
            name: "Font Size", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return style && style.fontSize ? style.fontSize : 72; }
        },
        {
            name: "Fill", type: "ADBE Checkbox Control",
            valueProp: "ADBE Checkbox Control-0001",
            // On unless a style explicitly says otherwise: a legacy controller
            // (built before this checkbox existed) always forced fill on, so
            // backfilling it onto one must not turn fill off for anybody.
            value: function () { return style && style.applyFill === false ? 0 : 1; }
        },
        {
            name: "Fill Color", type: "ADBE Color Control",
            valueProp: "ADBE Color Control-0001",
            // Renamed from "Fill Colour" (UK spelling) -- capsetUpgradeControllerEffects
            // renames a legacy controller's effect in place rather than adding
            // a second one, so the value the user already set survives.
            legacyNames: ["Fill Colour"],
            value: function () {
                return style && style.fillColor ? style.fillColor.concat([1]) : [1, 1, 1, 1];
            }
        },
        {
            name: "Stroke", type: "ADBE Checkbox Control",
            valueProp: "ADBE Checkbox Control-0001",
            value: function () { return style && style.applyStroke ? 1 : 0; }
        },
        {
            name: "Stroke Color", type: "ADBE Color Control",
            valueProp: "ADBE Color Control-0001",
            value: function () {
                return style && style.strokeColor ? style.strokeColor.concat([1]) : [0, 0, 0, 1];
            }
        },
        {
            name: "Stroke Width", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return style && style.strokeWidth ? style.strokeWidth : 2; }
        },
        {
            name: "Tracking", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return style && style.tracking ? style.tracking : 0; }
        },
        {
            name: "Leading", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            // This fallback is always 0, never a captured style's number. 0
            // means "auto leading" (see capsetLinkToController), which is
            // also what a brand new text layer already does -- so an
            // untouched slider changes nothing. A plain captured `style`
            // carries only a NUMBER (the leading AE computed at capture
            // time), not whether auto-leading produced it, so trusting that
            // number here could silently turn auto-leading off for a layer
            // that had it on. capsetSeedControllerFromDoc, which seeds a
            // BRAND NEW controller, reads the document's own `autoLeading`
            // flag directly and does not have that problem.
            value: function () { return 0; }
        },
        {
            name: "All Caps", type: "ADBE Checkbox Control",
            valueProp: "ADBE Checkbox Control-0001",
            value: function () { return 0; }
        },
        // --- layout ------------------------------------------------------------
        {
            name: "Horizontal %", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 50; }
        },
        {
            name: "Baseline %", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () {
                return style && style.positionY !== undefined
                    ? style.positionY * 100
                    : CAPSET_BASELINE * 100;
            }
        },
        // --- visibility ------------------------------------------------------------
        {
            name: "Opacity", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 100; }
        },
        {
            name: "Fade In (frames)", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 0; }
        },
        {
            name: "Fade Out (frames)", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 0; }
        },
        // --- shadow ------------------------------------------------------------
        {
            name: "Drop Shadow", type: "ADBE Checkbox Control",
            valueProp: "ADBE Checkbox Control-0001",
            value: function () { return 0; }
        },
        {
            name: "Shadow Color", type: "ADBE Color Control",
            valueProp: "ADBE Color Control-0001",
            value: function () { return [0, 0, 0, 1]; }
        },
        {
            name: "Shadow Opacity", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 50; }
        },
        {
            name: "Shadow Distance", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 5; }
        },
        {
            name: "Shadow Softness", type: "ADBE Slider Control",
            valueProp: "ADBE Slider Control-0001",
            value: function () { return 10; }
        }
    ];
}

function capsetFindEffectByName(effects, name) {
    for (var i = 1; i <= effects.numProperties; i++) {
        if (effects.property(i).name === name) return effects.property(i);
    }
    return null;
}

function capsetAddControllerEffect(effects, spec) {
    var fx = effects.addProperty(spec.type);
    fx.name = spec.name;
    fx.property(spec.valueProp).setValue(spec.value());
    return fx;
}

/**
 * Bring an EXISTING controller null up to the current effect rig, without
 * disturbing anything the user has already dialled in.
 *
 * Two things can be true of a controller a past version of Capset built:
 *
 *   - it may carry "Fill Colour" (UK spelling) where the rig now expects
 *     "Fill Color" -- renamed IN PLACE, so the effect keeps its identity and
 *     current value, and every expression that already reads "Fill Color"
 *     (a fresh caption added to this same comp) finds it.
 *   - it is missing every effect added since it was built -- Stroke,
 *     Tracking, Opacity, the fades... -- added fresh, seeded the same way a
 *     brand new controller would be.
 *
 * An effect that is already correctly named is left completely alone. This
 * runs on every Add Captions and every Sync Style, and resetting sliders the
 * user has already moved on every rebuild would be its own bug report.
 */
function capsetUpgradeControllerEffects(controller, specs) {
    var effects = controller.property("ADBE Effect Parade");
    for (var i = 0; i < specs.length; i++) {
        var spec = specs[i];
        if (capsetFindEffectByName(effects, spec.name)) continue;

        var legacy = null;
        var legacyNames = spec.legacyNames || [];
        for (var j = 0; j < legacyNames.length; j++) {
            legacy = capsetFindEffectByName(effects, legacyNames[j]);
            if (legacy) break;
        }
        if (legacy) {
            legacy.name = spec.name;
        } else {
            capsetAddControllerEffect(effects, spec);
        }
    }
}

function capsetEnsureController(comp, style) {
    var specs = capsetControllerEffectSpecs(style);

    var existing = capsetFindController(comp);
    if (existing) {
        capsetUpgradeControllerEffects(existing, specs);
        return existing;
    }

    var controller = comp.layers.addNull();
    controller.name = CAPSET_CONTROLLER;
    controller.enabled = false;      // never renders
    controller.shy = true;
    controller.moveToBeginning();

    var effects = controller.property("ADBE Effect Parade");
    for (var i = 0; i < specs.length; i++) {
        capsetAddControllerEffect(effects, specs[i]);
    }

    return controller;
}

/**
 * Re-seed a BRAND NEW controller's text-styling sliders from the actual
 * TextDocument of the caption layer that was just created -- i.e. whatever
 * the Character panel was already set to when the user clicked Add Captions.
 *
 * Why this exists: captions inherit the Character panel on purpose
 * (capsetStyleText never touches font/size/colour), so a controller seeded
 * with fixed defaults (72pt, white, no stroke...) instead of the document's
 * OWN values meant ticking "Parent to Controller" silently changed how every
 * caption looked the moment the Source Text expression started actually
 * working -- a user with 110pt yellow text and a black stroke got 72pt white
 * text with no stroke. Reading the real document is the only way to make
 * parenting change nothing by default.
 *
 * Called EXACTLY ONCE per build, for the FIRST caption layer actually
 * created (empty captions are skipped, so it cannot be the caption that
 * never got a layer), and ONLY when capsetEnsureController just created the
 * controller rather than reusing one: an existing controller's sliders
 * belong to the user, and re-seeding them from whatever the Character panel
 * happens to be set to on THIS run would overwrite a look they chose on
 * purpose, the same mistake this function exists to fix for a new one.
 *
 * `style` is the build's own captured-style payload (normally {}); it is
 * still consulted, AFTER the document, for any field the document could not
 * answer -- keeping capsetControllerEffectSpecs' fallback chain intact for
 * everything downstream of this (Sync Style, an upgrade with no fresh layer
 * to read) rather than replacing it.
 */
function capsetSeedControllerFromDoc(controller, doc, style) {
    var docStyle = capsetReadStyleFromDoc(doc);
    var effects = controller.property("ADBE Effect Parade");

    function set(name, valueProp, value) {
        var fx = capsetFindEffectByName(effects, name);
        if (!fx) return;
        try { fx.property(valueProp).setValue(value); } catch (e) {}
    }

    set("Font Size", "ADBE Slider Control-0001",
        docStyle.fontSize ? docStyle.fontSize
            : (style && style.fontSize ? style.fontSize : 72));

    var applyFill = docStyle.applyFill !== undefined ? docStyle.applyFill
        : !(style && style.applyFill === false);
    set("Fill", "ADBE Checkbox Control-0001", applyFill ? 1 : 0);
    set("Fill Color", "ADBE Color Control-0001",
        (docStyle.fillColor || (style && style.fillColor) || [1, 1, 1]).concat([1]));

    var applyStroke = docStyle.applyStroke !== undefined ? docStyle.applyStroke
        : !!(style && style.applyStroke);
    set("Stroke", "ADBE Checkbox Control-0001", applyStroke ? 1 : 0);
    set("Stroke Color", "ADBE Color Control-0001",
        (docStyle.strokeColor || (style && style.strokeColor) || [0, 0, 0]).concat([1]));
    set("Stroke Width", "ADBE Slider Control-0001",
        docStyle.strokeWidth !== undefined ? docStyle.strokeWidth
            : (style && style.strokeWidth ? style.strokeWidth : 2));

    set("Tracking", "ADBE Slider Control-0001",
        docStyle.tracking ? docStyle.tracking : (style && style.tracking ? style.tracking : 0));

    set("All Caps", "ADBE Checkbox Control-0001", docStyle.allCaps ? 1 : 0);

    // 0 tells the Source Text expression to leave auto-leading ON (see
    // capsetLinkToController), so a document that already has auto-leading
    // on seeds a slider that changes nothing, and one that has it off seeds
    // its own explicit leading number instead of a guess.
    set("Leading", "ADBE Slider Control-0001",
        docStyle.autoLeading ? 0 : (docStyle.leading || 0));
}

/**
 * Add a Drop Shadow effect to a caption layer and link it to the controller.
 *
 * Ordinary effect-parameter expressions, not the Text Style API, so this
 * works on either expression engine. Match names and property names below
 * are the standard, long-documented "Drop Shadow" (ADBE Drop Shadow) effect
 * -- not something this rewrite is introducing -- but its scripting/expression
 * surface was NOT independently re-verified against Adobe's reference during
 * this change the way the Text Style API below was, since no fetchable
 * reference for it turned up; the fake host models it from long-standing
 * community documentation of its property names, and it should be confirmed
 * against a real Effect Controls panel (Shadow Color / Opacity / Direction /
 * Distance / Softness / Shadow Only) before this ships.
 *
 * Direction is deliberately left alone: nothing in the controller drives it,
 * so it stays whatever AE's own default is.
 */
function capsetLinkShadowToController(layer) {
    var parade = layer.property("ADBE Effect Parade");
    var shadow = parade.addProperty("ADBE Drop Shadow");
    shadow.name = "Capset Shadow";

    // `thisComp.layer(...)` is looked up INSIDE the try, not before it: a
    // missing controller (deleted by hand while captions stayed parented to
    // it) makes that lookup itself throw in real AE, and a throw outside the
    // try would leave a red layer -- precisely the outcome try/catch exists
    // to prevent.
    shadow.property("Shadow Color").expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  var col = c.effect("Shadow Color")("Color");\r' +
        '  [col[0], col[1], col[2], 1];\r' +
        '} catch (err) { value; }';

    // The checkbox lives here, not on the effect's enabled state, so
    // switching it off is one slider read rather than a per-layer toggle --
    // and so a caption that was individually re-enabled by hand is not
    // silently re-hidden by the next rebuild.
    shadow.property("Opacity").expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  c.effect("Drop Shadow")("Checkbox") === 1\r' +
        '    ? c.effect("Shadow Opacity")("Slider") : 0;\r' +
        '} catch (err) { value; }';

    shadow.property("Distance").expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  c.effect("Shadow Distance")("Slider");\r' +
        '} catch (err) { value; }';

    shadow.property("Softness").expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  c.effect("Shadow Softness")("Slider");\r' +
        '} catch (err) { value; }';
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
    // Position is measured in the PARENT'S space once a layer is parented,
    // and this expression computes a point in COMP space. Handing one to the
    // other is what put every caption off the bottom-right of the frame with
    // "Parent to Controller" ticked: addNull() leaves the null's anchor at
    // its top-left corner with the null itself at the comp centre, so a
    // caption computed at (w/2, h*0.85) was drawn that far DOWN AND RIGHT of
    // the centre -- out of frame by half a comp in each axis, every time.
    //
    // fromComp does the conversion. Guarded on hasParent so the same
    // expression is correct on a layer the user later unparents, and wrapped
    // in try/catch because an expression that errors disables itself and
    // leaves a red layer -- much worse than falling back to the layer's own
    // value.
    position.expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  var p = [thisComp.width * c.effect("Horizontal %")("Slider") / 100,\r' +
        '           thisComp.height * c.effect("Baseline %")("Slider") / 100];\r' +
        '  if (hasParent) {\r' +
        '    var q = parent.fromComp(p);\r' +
        '    [q[0], q[1]];\r' +
        '  } else {\r' +
        '    p;\r' +
        '  }\r' +
        '} catch (err) { value; }';

    // Opacity is ordinary Transform, not Source Text, so global opacity and
    // per-caption fades work on either expression engine. Fades measure from
    // the LAYER'S OWN inPoint/outPoint, not the controller's, so retiming one
    // caption keeps its fade attached to where it actually starts and ends;
    // "linear()" is a core expression function present on both engines. A
    // fade of 0 frames (the default) leaves that ramp at a constant 1, so it
    // multiplies away to nothing and Opacity == the controller's own slider,
    // which itself defaults to 100 -- the current look, unchanged.
    var opacity = layer.property("Transform").property("Opacity");
    opacity.expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  var op = c.effect("Opacity")("Slider") / 100;\r' +
        '  var fd = thisComp.frameDuration;\r' +
        '  var fadeInFrames = c.effect("Fade In (frames)")("Slider");\r' +
        '  var fadeOutFrames = c.effect("Fade Out (frames)")("Slider");\r' +
        '  var fadeIn = fadeInFrames > 0\r' +
        '    ? linear(time, inPoint, inPoint + fadeInFrames * fd, 0, 1) : 1;\r' +
        '  var fadeOut = fadeOutFrames > 0\r' +
        '    ? linear(time, outPoint - fadeOutFrames * fd, outPoint, 1, 0) : 1;\r' +
        '  value * op * fadeIn * fadeOut;\r' +
        '} catch (err) { value; }';

    capsetLinkShadowToController(layer);

    if (!useJsEngine) return false;

    // VERIFIED against the After Effects Text Style expression API, AE 17.0+,
    // JavaScript expression engine only (capsetUsesJsEngine gates this whole
    // block on exactly that):
    //   https://ae-expressions.docsforadobe.dev/text/style/            (TextStyle methods)
    //   https://helpx.adobe.com/after-effects/using/expressions-text-properties.html
    //     ("Use expressions to edit and access text properties" -- the official page)
    //   https://motiondeveloper.com/blog/text-style-expressions
    //     (worked chained example: text.sourceText.style.setFontSize(...).setFont(...))
    //
    // What was confirmed there and is relied on below:
    //   - a TextDocument's properties (t.fontSize = ...) CANNOT be assigned
    //     inside an expression -- that assignment is silently a no-op, which
    //     is the entire bug this replaces. `text.sourceText.style` returns a
    //     TextStyle object instead, and that object's setXxx() methods are
    //     the supported way to restyle text from an expression.
    //   - every setXxx() method returns a NEW TextStyle rather than mutating
    //     the one it was called on, so each call must be reassigned (chaining
    //     works because each method also returns `this`-equivalent for the
    //     NEXT call), and the expression's last statement must evaluate to a
    //     TextStyle (or TextDocument), not a plain number or color.
    //   - setFillColor()/setStrokeColor() take [r, g, b] (0-1); an
    //     ADBE Color Control's value is [r, g, b, a], so it is sliced to 3.
    //   - setFillColor() only shows if TextStyle.applyFill is true, so the
    //     "Fill" checkbox drives setApplyFill() directly rather than always
    //     forcing it on; some caption styling is stroke-only, and forcing
    //     fill on for that text would be exactly the kind of look-changing
    //     side effect this whole rig now has to avoid. setStrokeColor()/
    //     setStrokeWidth() likewise need setApplyStroke(true). This is what
    //     "Fill Colour did nothing" actually was: not just the assignment
    //     bug, but that even a correct assignment needs applyFill explicitly
    //     turned on for a document whose applyFill happened to be off.
    //   - setLeading() has no effect while TextStyle.isAutoLeading is true,
    //     so leading is only set after setAutoLeading(false); 0 is treated
    //     as "leave auto-leading on", which is also a new text layer's own
    //     default, so an untouched slider changes nothing.
    //   - setAllCaps(boolean) exists and needs no accompanying "apply" flag.
    // Only methods appearing in at least two of the sources above are used
    // here; nothing below is guessed.
    var sourceText = layer.property("Source Text");
    sourceText.expression =
        'try {\r' +
        '  var c = thisComp.layer("' + CAPSET_CONTROLLER + '");\r' +
        '  var style = text.sourceText.style;\r' +
        '  style = style.setFontSize(c.effect("Font Size")("Slider"));\r' +
        '  if (c.effect("Fill")("Checkbox") === 1) {\r' +
        '    var fill = c.effect("Fill Color")("Color");\r' +
        '    style = style.setApplyFill(true).setFillColor([fill[0], fill[1], fill[2]]);\r' +
        '  } else {\r' +
        '    style = style.setApplyFill(false);\r' +
        '  }\r' +
        '  if (c.effect("Stroke")("Checkbox") === 1) {\r' +
        '    var stroke = c.effect("Stroke Color")("Color");\r' +
        '    style = style.setApplyStroke(true)\r' +
        '      .setStrokeColor([stroke[0], stroke[1], stroke[2]])\r' +
        '      .setStrokeWidth(c.effect("Stroke Width")("Slider"));\r' +
        '  } else {\r' +
        '    style = style.setApplyStroke(false);\r' +
        '  }\r' +
        '  style = style.setTracking(c.effect("Tracking")("Slider"));\r' +
        '  var leading = c.effect("Leading")("Slider");\r' +
        '  style = leading > 0\r' +
        '    ? style.setAutoLeading(false).setLeading(leading)\r' +
        '    : style.setAutoLeading(true);\r' +
        '  style = style.setAllCaps(c.effect("All Caps")("Checkbox") === 1);\r' +
        '  style;\r' +
        '} catch (err) { value; }';
    return true;
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
/**
 * Read the styling a TextDocument actually carries, in the shape the rest of
 * Capset already passes around as `style` (capsetCaptureStyle,
 * capsetApplyStyleToLayer, capsetSyncStyle). One reader, so a field added for
 * one caller (the controller rig seeding itself off a fresh caption's
 * Character-panel look) is available to the others without a second copy of
 * the same field list drifting out of sync.
 *
 * fillColor and strokeColor are guarded: fillColor throws on read when
 * applyFill is false, and this project has no reason to believe strokeColor
 * is any different, so both are read defensively rather than assumed safe.
 */
function capsetReadStyleFromDoc(doc) {
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
    // Both read-only in classic TextDocument scripting, and both exactly
    // what the controller rig needs to reproduce a caption's inherited look:
    // allCaps mirrors the Character panel's All Caps toggle, and autoLeading
    // says whether `leading` above is a real chosen number or just whatever
    // AE computed automatically -- seeding a slider with the latter would
    // silently turn auto-leading off for a layer that never had it off.
    try { style.allCaps = doc.allCaps; } catch (e) {}
    try { style.autoLeading = doc.autoLeading; } catch (e) {}
    return style;
}

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
        var style = capsetReadStyleFromDoc(doc);
        try { style.position = source.property("Transform").property("Position").value; } catch (e) {}
        try { style.scale = source.property("Transform").property("Scale").value; } catch (e) {}
        // Recorded WITH the style, not looked up at apply time: position is
        // stored proportionally, and applyStyleToLayer skips it entirely
        // without these. Their absence made every synced caption keep its old
        // position, which read as the feature not working at all.
        style.sourceWidth = comp.width;
        style.sourceHeight = comp.height;

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

/**
 * Route the part of a synced style that the controller rig owns onto the
 * controller's own effects, for a comp that has one.
 *
 * Font Size, Fill (on/off and color), Stroke (on/off, color and width) and
 * Tracking are driven through Source Text's expression once a caption is
 * linked to a controller (see
 * "controller rig" above) -- so capsetApplyStyleToLayer writing them onto a
 * linked layer's TextDocument is writing to a value the expression
 * overrides on its very next evaluation, which for a linked layer is
 * effectively immediately. Before this, Sync Style looked like it silently
 * did nothing for exactly those fields, on exactly the projects using the
 * feature the sync exists to make easier.
 *
 * capsetApplyStyleToLayer still runs on every layer regardless: a caption
 * that is not parented to the controller (an older comp, or the legacy
 * expression engine) has no expression to fight it, so it still needs the
 * per-layer write, and running both is harmless where the controller wins.
 *
 * A legacy controller is brought up to the current names/effects first
 * (capsetUpgradeControllerEffects), so this always writes to the effect the
 * rig currently expects, whatever version built the controller.
 */
function capsetSyncControllerFromStyle(comp, style) {
    var controller = capsetFindController(comp);
    if (!controller) return false;

    capsetUpgradeControllerEffects(controller, capsetControllerEffectSpecs(style));
    var effects = controller.property("ADBE Effect Parade");

    function set(name, valueProp, value) {
        var fx = capsetFindEffectByName(effects, name);
        if (!fx) return;
        try { fx.property(valueProp).setValue(value); } catch (e) {}
    }

    if (style.fontSize) set("Font Size", "ADBE Slider Control-0001", style.fontSize);
    if (style.applyFill !== undefined) {
        set("Fill", "ADBE Checkbox Control-0001", style.applyFill ? 1 : 0);
    }
    if (style.fillColor) {
        set("Fill Color", "ADBE Color Control-0001", style.fillColor.concat([1]));
    }
    if (style.applyStroke !== undefined) {
        set("Stroke", "ADBE Checkbox Control-0001", style.applyStroke ? 1 : 0);
    }
    if (style.strokeColor) {
        set("Stroke Color", "ADBE Color Control-0001", style.strokeColor.concat([1]));
    }
    if (style.strokeWidth !== undefined) {
        set("Stroke Width", "ADBE Slider Control-0001", style.strokeWidth);
    }
    if (style.tracking !== undefined) {
        set("Tracking", "ADBE Slider Control-0001", style.tracking);
    }
    return true;
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

// Effect copying goes through the clipboard, because After Effects has no
// scripting API for duplicating an effect together with its parameter values.
// That has two consequences worth stating plainly:
//
//  1. Menu commands act on the ACTIVE composition. Selecting a layer in some
//     other comp does not redirect a Paste there, so copying effects across a
//     whole project would paste them into whatever comp happens to be open.
//     Effects are therefore copied within the active comp only; a project-wide
//     sync still pushes type and position everywhere. The result reports how
//     many layers actually received effects so the panel can say so rather
//     than implying more happened than did.
//
//  2. It hijacks the selection. Whatever the user had selected is restored
//     afterwards.

function capsetDeselectAll(comp) {
    for (var i = 1; i <= comp.numLayers; i++) {
        try { comp.layer(i).selected = false; } catch (e) {}
    }
}

/**
 * Remember which layers are selected, by index rather than by name.
 *
 * Caption layers are named after what they say, so two captions of "Yeah."
 * carry the same name -- and restoring a selection by name would select both
 * when the user had one. Indices are unique for as long as the selection is
 * held, which is within a single host call that adds and removes no layers.
 */
function capsetSelectionNames(comp) {
    var indices = [];
    var selected = comp.selectedLayers;
    for (var i = 0; i < selected.length; i++) indices.push(selected[i].index);
    return indices;
}

function capsetRestoreSelection(comp, indices) {
    capsetDeselectAll(comp);
    for (var j = 0; j < indices.length; j++) {
        var index = indices[j];
        if (index >= 1 && index <= comp.numLayers) {
            try { comp.layer(index).selected = true; } catch (e) {}
        }
    }
}

/** Put a layer's effects on the clipboard. Returns how many were selected. */
function capsetCopyEffectsToClipboard(sourceLayer, comp) {
    var parade = sourceLayer.property("ADBE Effect Parade");
    if (!parade.numProperties) return 0;

    capsetDeselectAll(comp);
    try { sourceLayer.selected = true; } catch (e) {}

    var selected = 0;
    for (var i = 1; i <= parade.numProperties; i++) {
        try {
            parade.property(i).selected = true;
            selected++;
        } catch (e) {}
    }
    if (!selected) return 0;
    try {
        app.executeCommand(app.findMenuCommandId("Copy"));
    } catch (e) {
        return 0;
    }
    return selected;
}

/** Replace a layer's effects with whatever is on the clipboard. */
function capsetPasteEffectsOnto(targetLayer, comp) {
    var parade = targetLayer.property("ADBE Effect Parade");
    for (var i = parade.numProperties; i >= 1; i--) {
        try { parade.property(i).remove(); } catch (e) {}
    }
    capsetDeselectAll(comp);
    try { targetLayer.selected = true; } catch (e) {}
    try {
        app.executeCommand(app.findMenuCommandId("Paste"));
        return true;
    } catch (e) {
        return false;
    }
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
        var activeComp = capsetActiveComp();
        var comps = scope === "project" ? capsetAllComps() : [activeComp];

        app.beginUndoGroup("Capset: sync caption style");
        undoOpen = true;

        // The clipboard only reaches the active comp (see the note above
        // capsetCopyEffectsToClipboard), so effects are copied there and the
        // caller is told how far they got.
        var selectionBefore = null;
        var effectSource = null;
        if (payload.copyEffects) {
            selectionBefore = capsetSelectionNames(activeComp);
            if (payload.sourceCompName === activeComp.name &&
                payload.sourceLayerIndex >= 1 &&
                payload.sourceLayerIndex <= activeComp.numLayers) {
                effectSource = activeComp.layer(payload.sourceLayerIndex);
            }
            if (effectSource &&
                !capsetCopyEffectsToClipboard(effectSource, activeComp)) {
                effectSource = null;   // nothing to paste
            }
        }

        var updated = 0;
        var compsTouched = 0;
        var effectsCopied = 0;
        var controllersUpdated = 0;
        for (var c = 0; c < comps.length; c++) {
            var comp = comps[c];
            var layers = capsetTextLayers(comp, true);
            if (!layers.length) continue;
            compsTouched++;
            if (capsetSyncControllerFromStyle(comp, style)) controllersUpdated++;
            for (var i = 0; i < layers.length; i++) {
                capsetApplyStyleToLayer(layers[i], style, comp);
                updated++;
                if (effectSource && comp === activeComp &&
                    layers[i] !== effectSource &&
                    capsetPasteEffectsOnto(layers[i], comp)) {
                    effectsCopied++;
                }
            }
        }

        if (selectionBefore) {
            capsetRestoreSelection(activeComp, selectionBefore);
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
            scope: scope,
            effectsCopied: effectsCopied,
            controllersUpdated: controllersUpdated,
            // True when the user asked for effects across the project and only
            // the active comp could get them, so the panel can say so instead
            // of letting the user assume it worked everywhere.
            effectsLimitedToActiveComp:
                payload.copyEffects === true && scope === "project"
        });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

/** Remove every Capset caption layer, so a rebuild replaces rather than stacks. */
// ---------------------------------------------------------------------------
// SRT export
//
// Reads the captions off the TIMELINE rather than remembering what was
// transcribed. Everything the user has done since -- retimed a layer, fixed a
// typo, deleted a caption -- is in the file that comes out, which is the
// whole point of exporting from a project rather than from a transcript.
// ---------------------------------------------------------------------------

/** A caption layer's text, as one string. Null if it has none. */
function capsetLayerText(layer) {
    try {
        var prop = layer.property("Source Text");
        if (!prop) return null;
        var doc = prop.value;
        if (!doc) return null;
        var text = doc.text;
        return (text === undefined || text === null) ? null : String(text);
    } catch (e) {
        return null;
    }
}

/**
 * Collect caption layers from a comp, descending into a Capset precomp.
 *
 * `offset` shifts an inner comp's times into the outer comp's timeline: a
 * precomposed caption at 2s inside a precomp that starts at 10s is at 12s in
 * the comp the user is looking at, and an SRT that said 2s would be wrong for
 * every caption in the file.
 */
function capsetCollectCaptions(comp, offset, out) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (!capsetIsCapsetLayer(layer) || layer.name === CAPSET_CONTROLLER) continue;

        var source = null;
        try {
            if (layer.source && layer.source instanceof CompItem) source = layer.source;
        } catch (e) {}
        if (source) {
            capsetCollectCaptions(source, offset + layer.startTime, out);
            continue;
        }

        var text = capsetLayerText(layer);
        if (text === null || !capsetTrim(text).length) continue;

        out.push({
            text: capsetTrim(text.replace(/[\r\n]+/g, " ")),
            lines: text.split(/[\r\n]+/),
            start: layer.inPoint + offset,
            end: layer.outPoint + offset,
            // What the Proofread tab edits: the text exactly as the layer
            // holds it, line breaks and all, and where to find the layer
            // again. The SRT export reads none of these.
            body: capsetProofBody(text),
            ref: { compId: comp.id, index: i, layerId: capsetLayerId(layer) }
        });
    }
    return out;
}

/**
 * @returns {captions, comp} — captions carry seconds, for js/lib/srt.js to
 *          format. The timecode maths lives there, tested, rather than being
 *          written a second time in ExtendScript.
 */
function capsetCaptionsForExport() {
    try {
        var comp = capsetActiveComp();
        var captions = capsetCollectCaptions(comp, 0, []);
        if (!captions.length) {
            throw new Error(
                "No Capset captions in \"" + comp.name + "\". Add captions " +
                "before exporting an SRT."
            );
        }
        return capsetOk({ comp: comp.name, captions: captions });
    } catch (e) {
        return capsetErr(e.message);
    }
}

/** Strip what a filesystem will not take, so a caption comp name is safe. */
function capsetSafeFileName(name) {
    // The / is escaped inside the class on purpose: ExtendScript's regex
    // scanner reads \\ followed by a bare / as the end of the literal and
    // corrupts the rest of the file. panel/tests/jsx.test.js guards this.
    var safe = capsetTrim(String(name || "captions").replace(/[\\\/:*?"<>|\r\n]+/g, "-"));
    // Windows also rejects a trailing dot or space on a file name.
    safe = safe.replace(/[. ]+$/, "");
    return safe.length ? safe : "captions";
}

/**
 * Write the SRT beside the project file, in a "Capset SRT" folder.
 *
 * Beside the project rather than anywhere else because that is the one
 * location the user already thinks of as this job's folder, and it needs no
 * dialog. An unsaved project has no such location, which is a thing the user
 * can fix in one keystroke -- so say that rather than falling back to
 * somewhere they will never find it.
 */
function capsetWriteSrt(payloadJson) {
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var text = payload.text || "";
        if (!capsetTrim(text).length) throw new Error("Nothing to write.");

        var projectFile = app.project ? app.project.file : null;
        if (!projectFile) {
            throw new Error(
                "Save the After Effects project first — Capset writes the SRT " +
                "next to it, and an unsaved project has nowhere to be next to."
            );
        }

        var folder = new Folder(projectFile.parent.fsName + "/" + CAPSET_SRT_FOLDER);
        if (!folder.exists && !folder.create()) {
            throw new Error("Could not create " + folder.fsName);
        }

        var file = new File(folder.fsName + "/" + capsetSafeFileName(payload.name) + ".srt");
        // UTF-8, so accented characters and non-Latin scripts survive the
        // round trip into whatever the user opens the file with. Set before
        // open(), which is when ExtendScript reads it.
        file.encoding = "UTF-8";
        if (!file.open("w")) throw new Error("Could not open " + file.fsName + " for writing.");
        var wrote = false;
        try {
            wrote = file.write(text);
        } finally {
            file.close();
        }
        if (!wrote) throw new Error("Could not write " + file.fsName);

        return capsetOk({ path: file.fsName, folder: folder.fsName });
    } catch (e) {
        return capsetErr(e.message);
    }
}

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

/**
 * Is this a range that can actually be rebuilt within?
 *
 * Every way a range can be wrong ends with too much being deleted or nothing
 * being deleted, and both look like a bug in the captions rather than in the
 * range. NaN is the one worth naming: it arrives from arithmetic on a missing
 * field, and every comparison against it is false, so a NaN range silently
 * removes nothing at all.
 */
function capsetUsableRange(range) {
    if (!range) return false;
    var start = Number(range.start);
    var duration = Number(range.duration);
    if (isNaN(start) || isNaN(duration)) return false;
    if (start < 0 || duration <= 0) return false;
    return true;
}

/**
 * Does this layer show anything inside the stretch being rebuilt?
 *
 * Half-open at both ends on purpose. Captions sit end to end -- one out point
 * IS the next in point, now that a caption is held until its successor
 * arrives -- so treating a touch as an overlap would take the neighbour on
 * each side of every range with it, which is the behaviour being fixed.
 */
function capsetLayerInRange(layer, range) {
    var end = range.start + range.duration;
    return layer.inPoint < end && layer.outPoint > range.start;
}

function capsetBuildCaptions(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var captions = payload.captions || [];
        var style = payload.style || {};
        var animation = payload.animation || null;
        var offset = payload.timeOffset || 0;
        var options = payload.options || {};
        // Absent for a whole-composition run, which replaces everything as it
        // always has. Present for a work-area one, which must not.
        var range = payload.replaceRange || null;

        // A scoped rebuild that has lost its range must NOT quietly become a
        // full one. Replacing every caption in the composition is the most
        // destructive thing this function can do, and doing it by accident --
        // because a range went missing somewhere between the panel and here
        // -- is indistinguishable, from the timeline, from the feature simply
        // not working. Reported exactly that way: "everything afterwards got
        // deleted" on a work-area run.
        //
        // The panel says which kind of run it meant, separately from the
        // range itself, so the two can be checked against each other. Refusing
        // costs the user one more click; the silent version costs them the
        // rest of their captions.
        if (payload.scoped && !capsetUsableRange(range)) {
            throw new Error(
                "This was meant to rebuild only the work area, but the panel " +
                "did not say which stretch. Nothing has been changed. Please " +
                "report this, then use Full Composition if you need to " +
                "continue."
            );
        }

        if (!captions.length) throw new Error("No captions to build.");

        var comp = capsetActiveComp();

        app.beginUndoGroup("Capset: add captions");
        undoOpen = true;

        // Rebuilding replaces rather than stacks: running Add Captions twice
        // should not leave two sets of layers fighting over the same frames.
        //
        // A work-area run replaces only what it captioned. It used to clear
        // the comp, so setting in and out points to redo one line word by
        // word threw away every caption outside them -- the rest of the pass
        // you were keeping. What is outside the range was not re-transcribed
        // and is not being rebuilt, so it stays.
        var replaced = 0;
        var precompOverrun = false;
        for (var r = comp.numLayers; r >= 1; r--) {
            var existing = comp.layer(r);
            if (capsetIsCapsetLayer(existing) && existing.name !== CAPSET_CONTROLLER) {
                if (range && !capsetLayerInRange(existing, range)) continue;
                // A precomposed caption layer owns a composition of its own.
                // Removing only the layer leaves that comp behind, so a user
                // who rebuilds a few times finds the project panel filling up
                // with dead "Capset__captions" items.
                var orphan = null;
                try {
                    if (existing.source &&
                        existing.source instanceof CompItem &&
                        capsetIsCapsetLayer(existing.source)) {
                        orphan = existing.source;
                    }
                } catch (e) {}
                // A range cannot reach inside a precomp: the captions in
                // there are layers of another composition, and removing the
                // one layer that holds them takes the ones outside the range
                // with it. Nothing here can prevent that, so it is reported
                // rather than done quietly.
                if (range && orphan &&
                    (existing.inPoint < range.start ||
                     existing.outPoint > range.start + range.duration)) {
                    precompOverrun = true;
                }
                existing.remove();
                if (orphan) {
                    try { orphan.remove(); } catch (e) {}
                }
                replaced++;
            }
        }

        var controller = null;
        var linkStyle = false;
        // Whether THIS call is the one that created the controller, as
        // opposed to reusing a comp's existing one. Only a brand new
        // controller gets re-seeded from the first caption's actual
        // TextDocument below -- an existing controller's sliders are the
        // user's, not something a later Add Captions run gets to overwrite.
        var controllerIsNew = false;
        var controllerSeededFromDoc = false;
        if (options.parentToController) {
            controllerIsNew = !capsetFindController(comp);
            controller = capsetEnsureController(comp, style);
            // The controller carries Font Size, Fill Color, Stroke, Tracking,
            // Leading and All Caps sliders, all driven through Source Text.
            // Without the expressions that read them they are decoration: the
            // user drags a slider and nothing moves. Only the JavaScript
            // engine can restyle a text document from an expression (see
            // capsetLinkToController), so on the legacy engine the captions
            // are still parented and still follow Baseline %, Horizontal %,
            // Opacity and the fades, which are ordinary Transform properties.
            linkStyle = capsetUsesJsEngine();
        }

        var created = [];
        var i;
        for (i = 0; i < captions.length; i++) {
            var caption = captions[i];
            var text = caption.lines ? caption.lines.join("\r") : caption.text;

            // Nothing to show. An empty text layer is invisible but real: it
            // sits in the timeline, gets counted as a caption, and is one more
            // thing to delete by hand. Transcripts do produce these.
            if (!text || !capsetTrim(text).length) continue;

            var layer = comp.layers.addText(text);
            layer.name = capsetLayerName(text);
            // The tag, not the name, is what makes this a Capset layer.
            try { layer.comment = CAPSET_TAG; } catch (e) {}

            var inPoint = capsetSnap(comp, offset + caption.start);
            var outPoint = capsetSnap(comp, offset + caption.end);
            // Guarantee at least one frame. Two ways to get here, and the
            // second is the common one:
            //
            //   - the recogniser emitted a word whose end is at or before its
            //     start, which it does at chunk boundaries;
            //   - a genuinely short word -- fast speech easily produces 20ms
            //     -- snapped both ends onto the SAME frame.
            //
            // Either way the layer would have zero length and never appear, so
            // the caption silently goes missing rather than being brief.
            // A caption may not outlive the stretch that was captioned.
            // hold() runs the last one on past its final word so the screen
            // does not blank, and in a work-area run that pushes it beyond
            // the out point -- on top of the captions this rebuild
            // deliberately left standing there. Reported as "the last word of
            // the out held on for like a second and a half".
            if (range) {
                var rangeEnd = capsetSnap(comp, range.start + range.duration);
                if (outPoint > rangeEnd) outPoint = rangeEnd;
            }
            if (outPoint <= inPoint) {
                outPoint = inPoint + comp.frameDuration;
            }
            layer.inPoint = inPoint;
            layer.outPoint = outPoint;

            capsetStyleText(layer, style, comp);

            // The controller's text-styling sliders exist so far only with
            // fixed fallback defaults (capsetControllerEffectSpecs); this is
            // the one point where a document actually exists to read the
            // Character panel's real settings from, and only the FIRST
            // caption gets to set them -- doing this again for every caption
            // would just mean the last one written wins, for no reason.
            if (controllerIsNew && !controllerSeededFromDoc) {
                try {
                    capsetSeedControllerFromDoc(
                        controller, layer.property("Source Text").value, style
                    );
                } catch (e) {}
                controllerSeededFromDoc = true;
            }

            if (animation && caption.timings) {
                capsetApplyAnimation(layer, animation, caption.timings);
            }
            if (controller) {
                try { layer.parent = controller; } catch (e) {}
                try { capsetLinkToController(layer, linkStyle); } catch (e) {}
            }
            created.push(layer);
        }

        var precomposed = false;
        if (options.precompose && created.length) {
            var indices = [];
            for (i = 0; i < created.length; i++) indices.push(created[i].index);
            try {
                // Named with the prefix from the start, NOT renamed afterwards.
                // precompose() returns the new COMPOSITION, so assigning to
                // its .name renamed the project item and left the layer in the
                // timeline called something else -- something without the
                // Capset prefix, which capsetIsCapsetLayer could not recognise.
                // The next Add Captions therefore could not find the precomp
                // to remove, and stacked a second one on top of it.
                var precompName = CAPSET_PREFIX + "captions";
                var pre = comp.layers.precompose(indices, precompName, true);
                // Belt and braces: make certain the LAYER carries the name,
                // whatever the host called it.
                for (i = 1; i <= comp.numLayers; i++) {
                    if (comp.layer(i).source === pre) {
                        comp.layer(i).name = precompName;
                        break;
                    }
                }
                precomposed = true;
            } catch (e) {
                // Not fatal: the captions exist either way.
            }
        }

        return capsetOk({
            created: created.length,
            replaced: replaced,
            precomposed: precomposed,
            parented: controller !== null,
            // So the panel can say "replaced 4 in the work area" rather than
            // implying it cleared the comp.
            ranged: range !== null,
            rangeStart: range ? range.start : null,
            rangeDuration: range ? range.duration : null,
            precompOverrun: precompOverrun
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
    if (!layer) return false;
    // The tag first: it is what layers built by this version carry, and it
    // survives the user renaming a layer -- which they can now reasonably do,
    // because the name is prose rather than an identifier.
    try {
        if (layer.comment === CAPSET_TAG) return true;
    } catch (e) {}
    // The name second, for captions built before the tag existed. Dropping
    // this would orphan every caption in every project already out there:
    // Sync Style would stop finding them and a rebuild would stack a second
    // set on top of the first.
    return !!(layer.name && layer.name.indexOf(CAPSET_PREFIX) === 0);
}

/**
 * The layer name for a caption: what the caption says.
 *
 * Newlines become spaces because a layer name is one line -- a two-line
 * caption whose name contained a carriage return would render as a control
 * character in the timeline. Nothing else is altered: the point is to read
 * the transcript down the timeline, so a truncated or decorated name would
 * defeat it.
 */
function capsetLayerName(text) {
    var name = capsetTrim(String(text === undefined || text === null ? "" : text)
        .replace(/[\r\n]+/g, " "));
    // A caption with no text does not reach here (capsetBuildCaptions skips
    // it), but a name must never be empty: After Effects rejects that.
    return name || (CAPSET_PREFIX + "caption");
}

/**
 * @param payloadJson {animation, timingsById?, scope: "selected"|"all"}
 */
/**
 * Names and durations of the layers an animation would be applied to.
 *
 * The panel needs these so it can compute timings with js/lib/timing.js, the
 * one tested implementation of the rules. Without it, re-applying an animation
 * sent no timings at all and fell through to a hardcoded copy of the fraction
 * rules further down this file -- so the length the user had chosen was
 * silently ignored on every layer, and the duplicate could drift from the
 * real one without anything noticing.
 */
function capsetCaptionLayerTimes(scopeJson) {
    try {
        var payload = JSON.parse(scopeJson || "{}");
        var scope = payload.scope === "all" ? "all" : "selected";
        var comp = capsetActiveComp();
        var out = [];
        var i;

        if (scope === "all") {
            for (i = 1; i <= comp.numLayers; i++) {
                var candidate = comp.layer(i);
                if (candidate instanceof TextLayer && capsetIsCapsetLayer(candidate)) {
                    out.push({
                        // Keyed by index, not name: caption layers are named
                        // after their text, so two captions reading "Yeah."
                        // would share a key and one would take the other's
                        // timings.
                        id: candidate.index,
                        name: candidate.name,
                        duration: candidate.outPoint - candidate.inPoint
                    });
                }
            }
        } else {
            var selected = comp.selectedLayers;
            for (i = 0; i < selected.length; i++) {
                if (selected[i] instanceof TextLayer) {
                    out.push({
                        id: selected[i].index,
                        name: selected[i].name,
                        duration: selected[i].outPoint - selected[i].inPoint
                    });
                }
            }
        }
        return capsetOk({ layers: out, frameRate: comp.frameRate });
    } catch (e) {
        return capsetErr(e.message);
    }
}

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
            var timings = timingsById[layer.index];
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

// ---------------------------------------------------------------------------
// proofread
//
// The Proofread tab lists every caption with its text and timecodes, and lets
// them be retyped and retimed by hand. What each edit IS -- a new text, a new
// in point, a shift -- is decided in js/lib/proofread.js, where it is tested;
// this only finds the layers again and applies what it is handed.
//
// Every edit carries `expect`: the caption as the list last read it. A layer
// that no longer matches has been changed since -- by hand, by an undo, by
// another tool -- and the edit is refused rather than written over the top.
// A batch is checked in full before anything is written, so it never lands
// half-applied.
// ---------------------------------------------------------------------------

var CAPSET_STALE =
    "That caption has changed since the list was read, so nothing was " +
    "changed. The list has been refreshed -- try again.";

// Undo menu names for capsetProofreadApply. A fixed set rather than whatever
// the panel sends, so Edit > Undo always reads as something Capset did.
var CAPSET_PROOF_LABELS = {
    text: "edit caption",
    time: "retime caption",
    replace: "replace text",
    fix: "fix overlaps",
    shift: "shift captions"
};

/** A caption's text with one kind of line break, as the Proofread tab holds it. */
function capsetProofBody(text) {
    return capsetTrim(String(text === undefined || text === null ? "" : text)
        .replace(/\r\n?/g, "\n"));
}

/**
 * Layer.id where After Effects has it (22.0 and later), otherwise null.
 *
 * An id survives layers being added, removed and reordered; an index does
 * not. The index is still the fallback on older versions, and the `expect`
 * check is what makes relying on it safe: a different layer at that index
 * will not have the same text and times.
 */
function capsetLayerId(layer) {
    try {
        var id = layer.id;
        if (typeof id === "number") return id;
    } catch (e) {}
    return null;
}

/**
 * Lookups shared across one host call.
 *
 * Every call into the After Effects object model is slow, and a batch -- a
 * Shift all, a Replace All -- finds hundreds of captions in one go. Searching
 * the project and the comp afresh for each one made the cost grow with the
 * square of the caption count: 321,200 layer reads to shift 800 word
 * captions. With this, each comp's layers are read once per call.
 *
 * Never kept between calls. The `expect` check exists because the timeline
 * changes behind the panel's back; a cache that outlived the call would
 * reintroduce exactly that staleness. Keys are prefixed because ids are
 * numbers and these are plain objects.
 */
function capsetCaptionCache() {
    return { comps: null, layers: {}, located: {} };
}

function capsetCompById(id, cache) {
    cache = cache || capsetCaptionCache();
    if (!cache.comps) {
        cache.comps = {};
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) cache.comps["c" + item.id] = item;
        }
    }
    return cache.comps["c" + id] || null;
}

/** A comp's layers by Layer.id, read once per call. */
function capsetLayersById(comp, cache) {
    var key = "c" + comp.id;
    var byId = cache.layers[key];
    if (!byId) {
        byId = {};
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var id = capsetLayerId(layer);
            if (id !== null) byId["l" + id] = layer;
        }
        cache.layers[key] = byId;
    }
    return byId;
}

/**
 * Where `target` sits inside `within`, following Capset precomps down.
 *
 * @returns {offset, holder} -- `offset` puts target's times on within's
 *          timeline, `holder` is the layer in `within` that leads to it (null
 *          when target IS within) -- or null when target is not in there.
 *
 * Worked out afresh on every call rather than trusted from the list, so a
 * precomp moved since the list was read still has its captions written in
 * the right place.
 */
function capsetLocateComp(target, within, depth) {
    if (target.id === within.id) return { offset: 0, holder: null };
    if (depth > 8) return null;
    for (var i = 1; i <= within.numLayers; i++) {
        var layer = within.layer(i);
        if (!capsetIsCapsetLayer(layer)) continue;
        var source = null;
        try {
            if (layer.source && layer.source instanceof CompItem) source = layer.source;
        } catch (e) {}
        if (!source) continue;
        var inner = capsetLocateComp(target, source, depth + 1);
        if (inner) return { offset: layer.startTime + inner.offset, holder: layer };
    }
    return null;
}

/** The caption layer a ref points at, or null. Checks nothing else. */
function capsetFindCaption(ref, cache) {
    if (!ref) return null;
    cache = cache || capsetCaptionCache();
    var comp = capsetCompById(ref.compId, cache);
    if (!comp) return null;
    var layer = null;
    if (ref.layerId !== null && ref.layerId !== undefined) {
        layer = capsetLayersById(comp, cache)["l" + ref.layerId] || null;
    } else if (ref.index >= 1 && ref.index <= comp.numLayers) {
        layer = comp.layer(ref.index);
    }
    if (!layer || !(layer instanceof TextLayer) || !capsetIsCapsetLayer(layer)) return null;
    return { comp: comp, layer: layer };
}

/**
 * The caption a ref points at, provided it still says and spans exactly what
 * `expect` says it did. Throws CAPSET_STALE otherwise.
 */
function capsetResolveCaption(ref, expect, active, cache) {
    cache = cache || capsetCaptionCache();
    var found = capsetFindCaption(ref, cache);
    if (!found || !expect) throw new Error(CAPSET_STALE);
    var key = "c" + found.comp.id;
    if (!cache.located.hasOwnProperty(key)) {
        cache.located[key] = capsetLocateComp(found.comp, active, 0);
    }
    var located = cache.located[key];
    if (!located) throw new Error(CAPSET_STALE);
    var half = (found.comp.frameDuration || 0.002) / 2;
    if (capsetProofBody(capsetLayerText(found.layer)) !== expect.text ||
        Math.abs(found.layer.inPoint + located.offset - Number(expect.start)) > half ||
        Math.abs(found.layer.outPoint + located.offset - Number(expect.end)) > half) {
        throw new Error(CAPSET_STALE);
    }
    found.offset = located.offset;
    return found;
}

/** A caption as the Proofread tab lists it. */
function capsetProofRow(found) {
    return {
        ref: {
            compId: found.comp.id,
            index: found.layer.index,
            layerId: capsetLayerId(found.layer)
        },
        text: capsetProofBody(capsetLayerText(found.layer)),
        start: found.layer.inPoint + found.offset,
        end: found.layer.outPoint + found.offset
    };
}

/** Refuse to retype a caption whose text is keyframed. */
function capsetCheckTextEditable(layer) {
    if (layer.property("Source Text").numKeys > 0) {
        throw new Error(
            "\"" + layer.name + "\" has Source Text keyframes, so its text " +
            "changes over time. Edit that one in the timeline."
        );
    }
}

/**
 * Retype a caption, keeping its look.
 *
 * The document is read, changed and written back rather than replaced, so
 * font, size, colour and everything else the Character panel set stays put.
 * Its PRE-expression value is the one read: with Parent to Controller on the
 * JavaScript engine, Source Text carries an expression, and .value is what
 * that expression produced -- the controller's size and colours, not the
 * layer's. Writing that back would bake the controller's current look into
 * the layer.
 *
 * The layer is renamed to match only if its name still matches its old
 * text. A caption someone renamed on purpose keeps the name they gave it,
 * and so does a legacy Capset__cap_N layer, which is recognised by that name.
 */
function capsetWriteCaptionText(layer, text) {
    var prop = layer.property("Source Text");
    var oldText = capsetLayerText(layer);
    var hasExpression = false;
    try {
        hasExpression = !!prop.expressionEnabled && prop.expression !== "";
    } catch (e) {}
    var doc = hasExpression ? prop.valueAtTime(0, true) : prop.value;
    doc.text = String(text).replace(/\n/g, "\r");
    prop.setValue(doc);
    if (layer.name === capsetLayerName(oldText)) layer.name = capsetLayerName(text);
}

/**
 * Where an edit puts a caption, in its own comp's time, checked but not yet
 * applied. `start` and `end` trim; `shiftBy` moves the whole layer.
 */
function capsetPlanTimes(found, edit) {
    var comp = found.comp;
    var layer = found.layer;
    var fd = comp.frameDuration || 0;
    var shiftBy = edit.shiftBy ? capsetSnap(comp, Number(edit.shiftBy)) : 0;
    var hasStart = edit.start !== undefined && edit.start !== null;
    var hasEnd = edit.end !== undefined && edit.end !== null;
    var inPoint = hasStart
        ? capsetSnap(comp, Number(edit.start) - found.offset)
        : layer.inPoint + shiftBy;
    var outPoint = hasEnd
        ? capsetSnap(comp, Number(edit.end) - found.offset)
        : layer.outPoint + shiftBy;

    if (isNaN(inPoint) || isNaN(outPoint) || isNaN(shiftBy)) {
        throw new Error("A caption time arrived as something other than a number.");
    }
    if (outPoint - inPoint < fd / 2) {
        throw new Error("\"" + layer.name + "\" would end before it starts.");
    }
    if (inPoint + found.offset < -fd / 2) {
        throw new Error("\"" + layer.name + "\" would start before the composition.");
    }
    return {
        shiftBy: shiftBy,
        trim: hasStart || hasEnd,
        inPoint: inPoint,
        outPoint: outPoint
    };
}

function capsetApplyTimes(layer, plan) {
    if (plan.shiftBy) {
        // Moving the layer rather than trimming both ends, so anything
        // keyframed on the caption travels with it.
        layer.startTime = layer.startTime + plan.shiftBy;
        return;
    }
    if (!plan.trim) return;
    // A text layer has no source to run out of, but its in point is still
    // measured from its start time; move the start back first if the caption
    // is being extended earlier than it. Not verified against a host that
    // refuses otherwise -- harmless on one that does not.
    if (plan.inPoint < layer.startTime) layer.startTime = plan.inPoint;
    // After Effects refuses an in point at or after the out point, so which
    // end goes first depends on which way the caption is moving.
    if (plan.inPoint >= layer.outPoint) {
        layer.outPoint = plan.outPoint;
        layer.inPoint = plan.inPoint;
    } else {
        layer.inPoint = plan.inPoint;
        layer.outPoint = plan.outPoint;
    }
}

function capsetSameLayer(a, b) {
    return a.comp.id === b.comp.id && a.layer.index === b.layer.index;
}

/** Every caption in the active comp, in time order. */
function capsetProofreadList() {
    try {
        var comp = capsetActiveComp();
        var found = capsetCollectCaptions(comp, 0, []);
        var rows = [];
        for (var i = 0; i < found.length; i++) {
            rows.push({
                ref: found[i].ref,
                text: found[i].body,
                start: found[i].start,
                end: found[i].end
            });
        }
        // Layer order is not caption order: a work-area rebuild adds new
        // captions on top of the old ones.
        rows.sort(function (a, b) { return (a.start - b.start) || (a.end - b.end); });

        var dropFrame = false;
        var displayStartTime = 0;
        try { dropFrame = !!comp.dropFrame; } catch (e) {}
        try { displayStartTime = comp.displayStartTime || 0; } catch (e) {}
        return capsetOk({
            comp: {
                id: comp.id,
                name: comp.name,
                frameRate: comp.frameRate,
                frameDuration: comp.frameDuration,
                dropFrame: dropFrame,
                displayStartTime: displayStartTime,
                duration: comp.duration
            },
            captions: rows
        });
    } catch (e) {
        return capsetErr(e.message);
    }
}

/**
 * Apply edits from the Proofread tab: {label, edits: [{ref, expect, text?,
 * start?, end?, shiftBy?}]}. One undo step, whatever the number of edits.
 */
function capsetProofreadApply(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var edits = payload.edits || [];
        if (!edits.length) throw new Error("Nothing to change.");
        var active = capsetActiveComp();
        var cache = capsetCaptionCache();

        var plans = [];
        var i;
        for (i = 0; i < edits.length; i++) {
            var edit = edits[i];
            var found = capsetResolveCaption(edit.ref, edit.expect, active, cache);
            for (var k = 0; k < plans.length; k++) {
                if (capsetSameLayer(plans[k].found, found)) {
                    throw new Error("The same caption was changed twice in one step.");
                }
            }
            var text = null;
            if (edit.text !== undefined && edit.text !== null) {
                text = capsetProofBody(edit.text);
                if (!text.length) throw new Error("A caption cannot be empty.");
                capsetCheckTextEditable(found.layer);
            }
            plans.push({ found: found, text: text, times: capsetPlanTimes(found, edit) });
        }

        var label = CAPSET_PROOF_LABELS[payload.label] || "edit captions";
        app.beginUndoGroup("Capset: " + label);
        undoOpen = true;

        var rows = [];
        for (i = 0; i < plans.length; i++) {
            if (plans[i].text !== null) capsetWriteCaptionText(plans[i].found.layer, plans[i].text);
            capsetApplyTimes(plans[i].found.layer, plans[i].times);
            rows.push(capsetProofRow(plans[i].found));
        }
        return capsetOk({ rows: rows });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

/**
 * Split one caption into two: {ref, expect, first, second}, each half
 * {text, start, end}.
 *
 * The second half is a duplicate of the layer, so it keeps everything the
 * first has -- style, effects, the controller parent and its expressions, the
 * Capset tag -- without this having to know what those are.
 */
function capsetProofreadSplit(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var active = capsetActiveComp();
        var found = capsetResolveCaption(payload.ref, payload.expect, active);
        var first = payload.first;
        var second = payload.second;
        if (!first || !second) throw new Error("Nothing to split.");
        var firstText = capsetProofBody(first.text);
        var secondText = capsetProofBody(second.text);
        if (!firstText.length || !secondText.length) {
            throw new Error("Both halves of a split need some text.");
        }
        capsetCheckTextEditable(found.layer);
        var firstTimes = capsetPlanTimes(found, { start: first.start, end: first.end });
        var secondTimes = capsetPlanTimes(found, { start: second.start, end: second.end });

        app.beginUndoGroup("Capset: split caption");
        undoOpen = true;

        var layer = found.layer;
        var copy = layer.duplicate();
        // Named like the original, so the rename in capsetWriteCaptionText
        // treats both halves the same way whatever the host called the copy.
        copy.name = layer.name;
        try { if (layer.comment === CAPSET_TAG) copy.comment = CAPSET_TAG; } catch (e) {}

        capsetWriteCaptionText(layer, firstText);
        capsetApplyTimes(layer, firstTimes);
        capsetWriteCaptionText(copy, secondText);
        capsetApplyTimes(copy, secondTimes);
        return capsetOk({ created: 1 });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

/**
 * Merge a caption with the next: {ref, expect, next: {ref, expect}, text,
 * start, end}. The first layer takes the merged text and times, so it is the
 * first caption's look that survives; the second layer is removed.
 */
function capsetProofreadMerge(payloadJson) {
    var undoOpen = false;
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var active = capsetActiveComp();
        if (!payload.next) throw new Error("Nothing to merge with.");
        var cache = capsetCaptionCache();
        var a = capsetResolveCaption(payload.ref, payload.expect, active, cache);
        var b = capsetResolveCaption(payload.next.ref, payload.next.expect, active, cache);
        if (a.comp.id !== b.comp.id) {
            throw new Error(
                "Those two captions are in different compositions, so they " +
                "cannot be merged into one layer."
            );
        }
        if (capsetSameLayer(a, b)) throw new Error("A caption cannot be merged with itself.");
        var text = capsetProofBody(payload.text);
        if (!text.length) throw new Error("A caption cannot be empty.");
        capsetCheckTextEditable(a.layer);
        var times = capsetPlanTimes(a, { start: payload.start, end: payload.end });

        app.beginUndoGroup("Capset: merge captions");
        undoOpen = true;

        capsetWriteCaptionText(a.layer, text);
        capsetApplyTimes(a.layer, times);
        b.layer.remove();
        return capsetOk({ removed: 1 });
    } catch (e) {
        return capsetErr(e.message);
    } finally {
        if (undoOpen) app.endUndoGroup();
    }
}

/**
 * Move the playhead to a caption and select it: {ref, time}.
 *
 * A precomposed caption cannot be selected from the timeline the user is
 * looking at, so the precomp layer holding it is selected instead. Selection
 * and the playhead are not undoable in After Effects, so there is no undo
 * group to open.
 */
function capsetProofreadReveal(payloadJson) {
    try {
        var payload = JSON.parse(payloadJson || "{}");
        var active = capsetActiveComp();
        var time = Number(payload.time);
        if (!isNaN(time)) active.time = time;

        var selected = false;
        var found = capsetFindCaption(payload.ref);
        if (found) {
            var located = capsetLocateComp(found.comp, active, 0);
            if (located) {
                capsetDeselectAll(active);
                var target = located.holder || found.layer;
                try { target.selected = true; selected = true; } catch (e) {}
            }
        }
        return capsetOk({ selected: selected });
    } catch (e) {
        return capsetErr(e.message);
    }
}
