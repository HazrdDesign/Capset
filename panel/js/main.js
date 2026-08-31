/**
 * Panel wiring: three tabs (Insert / Update / Animate), the backend calls,
 * and the ExtendScript bridge.
 *
 * Timing, segmentation and SRT parsing live in js/lib/ and are unit-tested
 * under node. This file is glue and DOM.
 */
(function () {
  "use strict";

  var cs = new CSInterface();
  var backend = new CapsetBackendLib.CapsetBackend();
  var timing = CapsetTiming;
  var segmentation = CapsetSegmentation;
  var srt = CapsetSrt;

  var state = {
    srtPath: null,
    srtName: null,
    animations: [],
    selectedAnimation: null,
    compInfo: null,
    capturedStyle: null,
    busy: false
  };

  function $(id) { return document.getElementById(id); }
  function radio(name) {
    var checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : null;
  }

  // --- logging -------------------------------------------------------------

  function log(message, kind) {
    var line = document.createElement("div");
    if (kind) line.className = kind;
    var now = new Date();
    line.textContent =
      ("0" + now.getHours()).slice(-2) + ":" +
      ("0" + now.getMinutes()).slice(-2) + ":" +
      ("0" + now.getSeconds()).slice(-2) + "  " + message;
    $("log").appendChild(line);
    $("log").scrollTop = $("log").scrollHeight;
  }

  function setStatus(kind, message) {
    $("status").className = kind;
    $("status").querySelector(".msg").textContent = message;
  }

  function setBusy(busy) {
    state.busy = busy;
    var ids = ["build", "pick", "capture", "sync", "clear",
               "anim-selected", "anim-all", "anim-clear"];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.disabled = busy;
    }
    if (!busy && !state.capturedStyle) $("sync").disabled = true;
    $("progress").className = busy ? "active" : "";
  }

  function setProgress(fraction, text) {
    $("bar-fill").style.width = Math.round(fraction * 100) + "%";
    if (text) $("progress-text").textContent = text;
  }

  // --- ExtendScript bridge -------------------------------------------------

  function host(call) {
    return new Promise(function (resolve, reject) {
      cs.evalScript(call, function (raw) {
        if (raw === "EvalScript error.") {
          reject(new Error("ExtendScript failed. Check the AE console."));
          return;
        }
        var parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          reject(new Error("Unexpected host response: " + String(raw).slice(0, 200)));
          return;
        }
        if (!parsed.ok) reject(new Error(parsed.error || "Host error"));
        else resolve(parsed.data);
      });
    });
  }

  function arg(value) {
    return JSON.stringify(JSON.stringify(value));
  }

  // --- backend health ------------------------------------------------------

  function checkHealth() {
    setStatus("warn", "Checking transcription service…");
    return backend.health().then(function (health) {
      if (health.status === "ok" && health.model_loaded) {
        setStatus("ok", "Ready — " + ((health.engine || {}).model || "model loaded"));
      } else if (health.status === "unreachable") {
        setStatus("error", "Service not running. Start the Capset backend.");
      } else {
        setStatus("warn", health.error || "Model still loading…");
      }
      return health;
    });
  }

  // --- animations ----------------------------------------------------------

  function loadAnimations() {
    return fetch("animations/animations.json")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        state.animations = data.animations || [];
        renderAnimations();
        if (state.animations.length) selectAnimation(state.animations[0].id);
      })
      .catch(function (err) {
        log("Could not load animation library: " + err.message, "err");
      });
  }

  function renderAnimations() {
    var grid = $("animations");
    grid.innerHTML = "";
    state.animations.forEach(function (animation) {
      var card = document.createElement("div");
      card.className = "anim";
      card.dataset.id = animation.id;
      card.title = animation.description || animation.name;

      var thumb = document.createElement("div");
      thumb.className = "thumb";
      var video = document.createElement("video");
      video.muted = true; video.loop = true; video.playsInline = true;
      video.src = animation.preview;
      video.addEventListener("error", function () {
        thumb.textContent = "no preview";
        if (video.parentNode) thumb.removeChild(video);
      });
      thumb.appendChild(video);
      card.addEventListener("mouseenter", function () {
        if (video.parentNode) video.play().catch(function () {});
      });
      card.addEventListener("mouseleave", function () { video.pause(); });

      var label = document.createElement("div");
      label.className = "label";
      label.textContent = animation.name;

      card.appendChild(thumb);
      card.appendChild(label);
      card.addEventListener("click", function () { selectAnimation(animation.id); });
      grid.appendChild(card);
    });
  }

  function selectAnimation(id) {
    state.selectedAnimation = null;
    state.animations.forEach(function (a) {
      if (a.id === id) state.selectedAnimation = a;
    });
    Array.prototype.forEach.call($("animations").children, function (card) {
      card.className = card.dataset.id === id ? "anim selected" : "anim";
    });
  }

  function timingsFor(caption, animation) {
    var duration = caption.end - caption.start;
    var spec = { maxInFraction: Number($("resolve").value) / 100 };
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
    return timing.computeTimings(duration, spec);
  }

  // --- file helpers --------------------------------------------------------

  function readBlob(path) {
    var read = window.cep.fs.readFile(path, window.cep.fs.NO_ENCODING);
    if (read.err) throw new Error("Could not read " + path + " (error " + read.err + ")");
    var binary = read.data;
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return new Blob([bytes]);
  }

  function readText(path) {
    var read = window.cep.fs.readFile(path);
    if (read.err) throw new Error("Could not read " + path + " (error " + read.err + ")");
    return read.data;
  }

  function pickSrt() {
    var result = window.cep.fs.showOpenDialog(
      false, false, "Choose a subtitle file", "", ["srt", "vtt"]
    );
    if (!result || !result.data || !result.data.length) return;
    state.srtPath = result.data[0];
    state.srtName = state.srtPath.split(/[\\/]/).pop();
    $("file-name").textContent = state.srtName;
    log("Selected " + state.srtName);
  }

  // --- build ---------------------------------------------------------------

  function buildOptions() {
    return {
      precompose: $("opt-precompose").checked,
      parentToController: $("opt-parent").checked,
      titleSafe: $("opt-titlesafe").checked
    };
  }

  function segmentationMode() {
    return $("opt-split").checked ? "word" : $("mode").value;
  }

  /** Resolve audio without a file dialog: the selected layer, or a render. */
  function resolveAudio(scope) {
    return host("capsetGetAudioSource(" + arg({ scope: scope }) + ")")
      .then(function (source) {
        if (source.mode === "file") {
          log("Audio from layer “" + source.layerName + "”");
          return source;
        }
        log(source.reason);
        setProgress(0.05, "Rendering composition audio…");
        return host("capsetRenderAudio(" + arg({ scope: scope }) + ")")
          .then(function (rendered) {
            return {
              mode: "render", path: rendered.path,
              start: source.start, duration: source.duration, layerStart: 0
            };
          });
      });
  }

  function captionsFromSrt() {
    var text = readText(state.srtPath);
    var parsed = srt.parse(text);
    parsed.errors.forEach(function (e) { log(e, "err"); });
    if (!parsed.captions.length) throw new Error("No usable cues in that file.");
    log(parsed.captions.length + " cues imported from " + state.srtName);
    return { captions: parsed.captions, offset: 0 };
  }

  function captionsFromTranscription(scope) {
    return resolveAudio(scope).then(function (source) {
      setProgress(0.08, "Uploading…");
      var name = source.path.split(/[\\/]/).pop();
      return backend.transcribe(
        readBlob(source.path), name,
        function (p, stage) { setProgress(0.08 + p * 0.82, stage); }
      ).then(function (result) {
        var out = segmentation.segment(result.words, {
          mode: segmentationMode(),
          width: state.compInfo.width,
          height: state.compInfo.height
        });
        if (out.layout) log(out.layout.rationale);
        log(result.words.length + " words → " + out.captions.length + " captions");
        // Layer audio starts at its own in-point in comp time; a rendered mix
        // starts at the range we asked for.
        var offset = source.mode === "file"
          ? (source.layerStart || 0)
          : (source.start || 0);
        return { captions: out.captions, offset: offset };
      });
    });
  }

  function build() {
    setBusy(true);
    setProgress(0, "Reading composition…");

    host("capsetGetCompInfo()")
      .then(function (info) {
        state.compInfo = info;
        log("Comp: " + info.name + " " + info.width + "×" + info.height);
        var scope = radio("duration");
        return radio("source") === "file"
          ? captionsFromSrt()
          : captionsFromTranscription(scope);
      })
      .then(function (payload) {
        setProgress(0.94, "Building layers…");
        var animation = state.selectedAnimation;
        var captions = payload.captions.map(function (caption) {
          return {
            text: caption.text,
            lines: caption.lines,
            start: caption.start,
            end: caption.end,
            timings: timingsFor(caption, animation)
          };
        });
        return host("capsetBuildCaptions(" + arg({
          captions: captions,
          animation: animation,
          style: { titleSafe: $("opt-titlesafe").checked },
          options: buildOptions(),
          timeOffset: payload.offset
        }) + ")");
      })
      .then(function (data) {
        setProgress(1, "Done");
        var parts = ["Built " + data.created + " caption layers"];
        if (data.replaced) parts.push("replaced " + data.replaced);
        if (data.precomposed) parts.push("precomposed");
        if (data.parented) parts.push("parented to controller");
        log(parts.join(", ") + ".", "ok");
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- update tab ----------------------------------------------------------

  function capture() {
    setBusy(true);
    host("capsetCaptureStyle()")
      .then(function (data) {
        data.style.sourceWidth = state.compInfo ? state.compInfo.width : null;
        data.style.sourceHeight = state.compInfo ? state.compInfo.height : null;
        state.capturedStyle = data;
        var box = $("captured");
        box.hidden = false;
        box.innerHTML =
          "Captured from <strong>" + data.sourceLayerName + "</strong><br>" +
          (data.style.font || "inherited font") + " &middot; " +
          Math.round(data.style.fontSize || 0) + "px" +
          (data.effectCount ? " &middot; " + data.effectCount + " effect(s)" : "");
        $("sync").disabled = false;
        log("Style captured from " + data.sourceLayerName, "ok");
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  function sync() {
    if (!state.capturedStyle) { log("Capture a style first.", "err"); return; }
    setBusy(true);
    // Refresh comp size so proportional positioning is relative to the comp
    // the style came from, not whichever comp is open now.
    host("capsetGetCompInfo()")
      .then(function (info) {
        state.compInfo = info;
        return host("capsetSyncStyle(" + arg({
          style: state.capturedStyle.style,
          effects: state.capturedStyle.effects,
          copyEffects: $("opt-effects").checked,
          scope: radio("scope")
        }) + ")");
      })
      .then(function (data) {
        log("Styled " + data.updated + " layer(s) across " +
            data.comps + " comp(s).", "ok");
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  function clearCaptions() {
    setBusy(true);
    host("capsetClearCaptions(" + arg({ removeController: true }) + ")")
      .then(function (data) { log("Removed " + data.removed + " layer(s).", "ok"); })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- animate tab ---------------------------------------------------------

  function applyAnimation(scope) {
    if (!state.selectedAnimation) { log("Pick an animation first.", "err"); return; }
    setBusy(true);
    host("capsetReplaceAnimation(" + arg({
      animation: state.selectedAnimation,
      scope: scope === "all" ? "all" : "selected",
      timingsById: {}
    }) + ")")
      .then(function (data) {
        log("Animated " + data.changed + " layer(s).", "ok");
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  function clearAnimation() {
    setBusy(true);
    host("capsetClearAnimations(" + arg({ scope: "all" }) + ")")
      .then(function (data) { log("Cleared animation on " + data.cleared + " layer(s).", "ok"); })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- wiring --------------------------------------------------------------

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
        t.classList.toggle("active", t === tab);
      });
      Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (p) {
        p.classList.toggle("active", p.dataset.panel === tab.dataset.tab);
      });
    });
  });

  Array.prototype.forEach.call(
    document.querySelectorAll('input[name="source"]'),
    function (input) {
      input.addEventListener("change", function () {
        $("file-row").hidden = radio("source") !== "file";
      });
    }
  );

  $("retry").addEventListener("click", checkHealth);
  $("pick").addEventListener("click", pickSrt);
  $("build").addEventListener("click", build);
  $("capture").addEventListener("click", capture);
  $("sync").addEventListener("click", sync);
  $("clear").addEventListener("click", clearCaptions);
  $("anim-selected").addEventListener("click", function () { applyAnimation("selected"); });
  $("anim-all").addEventListener("click", function () { applyAnimation("all"); });
  $("anim-clear").addEventListener("click", clearAnimation);
  $("resolve").addEventListener("input", function () {
    $("resolve-value").textContent = $("resolve").value;
  });
  $("mode").addEventListener("change", function () {
    var hints = {
      smart: "Reads the comp's aspect ratio and picks a layout.",
      word: "One caption per word. Punchy; best for vertical/social.",
      phrase: "Broadcast style — 42 characters per line, up to 2 lines."
    };
    $("mode-hint").textContent = hints[$("mode").value] || "";
  });

  checkHealth();
  loadAnimations();
  log("Capset panel ready.");
})();
