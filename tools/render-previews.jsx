/*
 * Generate preview loops for the animation library.
 *
 * Previews are rendered FROM the procedural engine rather than hand-made, so
 * what the panel shows can never drift from what actually gets applied. There
 * is no live render-to-panel path in CEP, so pre-rendered loops are the only
 * option -- the same approach Motion Bro and Animation Composer take.
 *
 * Run inside After Effects:  File > Scripts > Run Script File...
 * Then render the queue (or drive it headlessly with aerender).
 *
 * ExtendScript is ES3 -- plain var and indexed loops only.
 *
 * STATUS: not yet executed inside After Effects.
 */

#include "../panel/jsx/json2.jsx"
#include "../panel/jsx/capset.jsx"

(function () {
    var PREVIEW_W = 480;
    var PREVIEW_H = 300;
    var FPS = 30;
    // Long enough to read the motion, short enough to loop cleanly in a grid.
    var DURATION = 2.0;
    var SAMPLE_TEXT = "Capset";

    function readAnimations() {
        var file = new File(
            File($.fileName).parent.parent.fsName +
            "/panel/animations/animations.json"
        );
        if (!file.exists) {
            throw new Error("animations.json not found at " + file.fsName);
        }
        file.open("r");
        var raw = file.read();
        file.close();
        return JSON.parse(raw).animations || [];
    }

    function buildPreviewComp(animation) {
        var comp = app.project.items.addComp(
            "preview_" + animation.id, PREVIEW_W, PREVIEW_H, 1, DURATION, FPS
        );

        var bg = comp.layers.addSolid([0.08, 0.08, 0.08], "bg", PREVIEW_W, PREVIEW_H, 1);
        bg.locked = true;

        var layer = comp.layers.addText(SAMPLE_TEXT);
        layer.name = CAPSET_PREFIX + "preview";
        layer.inPoint = 0;
        layer.outPoint = DURATION;

        var prop = layer.property("Source Text");
        var doc = prop.value;
        doc.fontSize = 64;
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        doc.applyFill = true;
        doc.fillColor = [1, 1, 1];
        prop.setValue(doc);
        layer.property("Transform").property("Position").setValue(
            [PREVIEW_W / 2, PREVIEW_H / 2 + 20]
        );

        // Mirror js/lib/timing.js defaults so the preview shows the real
        // duration-adaptive behaviour rather than an idealised version.
        var inDur = Math.min(Math.max(DURATION * 0.25, 0.1), 0.45);
        inDur = Math.min(inDur, DURATION * 0.5);
        var outDur = Math.min(Math.max(DURATION * 0.2, 0.08), 0.35);
        outDur = Math.min(outDur, DURATION * 0.4);

        capsetApplyAnimation(layer, animation, {
            inStart: 0,
            inDuration: inDur,
            outStart: DURATION - outDur,
            outDuration: outDur
        });

        return comp;
    }

    function queueForRender(comp, animation) {
        var item = app.project.renderQueue.items.add(comp);
        var outDir = new Folder(
            File($.fileName).parent.parent.fsName + "/panel/animations/previews"
        );
        if (!outDir.exists) outDir.create();

        var om = item.outputModule(1);
        try {
            // H.264 keeps the shipped panel small. If this template is absent
            // the render still queues; the operator picks a module by hand.
            om.applyTemplate("H.264 - Match Render Settings -  15 Mbps");
        } catch (e) {
            // Template names differ per AE version and locale; not fatal.
        }
        om.file = new File(outDir.fsName + "/" + animation.id + ".mp4");
        return item;
    }

    app.beginUndoGroup("Capset: build animation previews");
    try {
        var animations = readAnimations();
        if (!animations.length) throw new Error("No animations defined.");

        var built = [];
        for (var i = 0; i < animations.length; i++) {
            var comp = buildPreviewComp(animations[i]);
            queueForRender(comp, animations[i]);
            built.push(animations[i].id);
        }

        alert(
            "Queued " + built.length + " previews:\n" + built.join(", ") +
            "\n\nRender the queue to write panel/animations/previews/*.mp4"
        );
    } catch (e) {
        alert("Capset preview build failed:\n" + e.message);
    } finally {
        app.endUndoGroup();
    }
})();
