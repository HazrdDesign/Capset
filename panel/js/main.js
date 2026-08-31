/**
 * Panel wiring: backend health, transcription, segmentation, and the
 * ExtendScript calls that build layers.
 *
 * Timing and segmentation live in js/lib/ and are unit-tested under node.
 * This file is glue and DOM, deliberately holding no logic worth testing.
 */
(function () {
  "use strict";

  var cs = new CSInterface();
  var backend = new CapsetBackendLib.CapsetBackend();
  var timing = CapsetTiming;
  var segmentation = CapsetSegmentation;

  var state = {
    filePath: null,
    fileName: null,
    animations: [],
    selectedAnimation: null,
    compInfo: null,
    busy: false
  };

  var el = {};
  ["status", "retry", "pick", "file-name", "mode", "mode-hint", "font-size",
   "position-y", "animations", "resolve", "resolve-value", "build", "progress",
   "bar-fill", "progress-text", "log", "replace-selected", "replace-all",
   "build-controller"
  ].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  // --- logging -------------------------------------------------------------

  function log(message, kind) {
    var line = document.createElement("div");
    if (kind) line.className = kind;
    var now = new Date();
    line.textContent =
      ("0" + now.getHours()).slice(-2) + ":" +
      ("0" + now.getMinutes()).slice(-2) + ":" +
      ("0" + now.getSeconds()).slice(-2) + "  " + message;
    el.log.appendChild(line);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function setStatus(kind, message) {
    el.status.className = kind;
    el.status.querySelector(".msg").textContent = message;
  }

  function setBusy(busy) {
    state.busy = busy;
    el.build.disabled = busy || !state.filePath;
    el.pick.disabled = busy;
    el["replace-selected"].disabled = busy;
    el["replace-all"].disabled = busy;
    el["build-controller"].disabled = busy;
    el.progress.className = busy ? "active" : "";
  }

  function setProgress(fraction, text) {
    el["bar-fill"].style.width = Math.round(fraction * 100) + "%";
    if (text) el["progress-text"].textContent = text;
  }

  // --- ExtendScript bridge -------------------------------------------------

  /** evalScript wrapped in a promise; host functions return our JSON envelope. */
  function host(fnCall) {
    return new Promise(function (resolve, reject) {
      cs.evalScript(fnCall, function (raw) {
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

  function hostArg(value) {
    // JSON inside a JS string literal inside evalScript: escape once.
    return JSON.stringify(JSON.stringify(value));
  }

  // --- backend health ------------------------------------------------------

  function checkHealth() {
    setStatus("warn", "Checking transcription service…");
    return backend.health().then(function (health) {
      if (health.status === "ok" && health.model_loaded) {
        var engine = health.engine || {};
        setStatus("ok", "Ready — " + (engine.model || "model loaded"));
      } else if (health.status === "unreachable") {
        setStatus("error", "Service not running. Start the Capset backend.");
      } else if (!health.model_loaded) {
        setStatus("warn", health.error || "Model still loading…");
      } else {
        setStatus("warn", health.status);
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
    el.animations.innerHTML = "";
    state.animations.forEach(function (animation) {
      var card = document.createElement("div");
      card.className = "anim";
      card.dataset.id = animation.id;
      card.title = animation.description || animation.name;

      var thumb = document.createElement("div");
      thumb.className = "thumb";
      // Previews are pre-rendered loops (there is no live render-to-panel in
      // CEP). Until they exist, degrade to the animation's name rather than a
      // broken video element.
      var video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
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
      el.animations.appendChild(card);
    });
  }

  function selectAnimation(id) {
    state.selectedAnimation = null;
    state.animations.forEach(function (a) {
      if (a.id === id) state.selectedAnimation = a;
    });
    Array.prototype.forEach.call(el.animations.children, function (card) {
      card.className = card.dataset.id === id ? "anim selected" : "anim";
    });
  }

  // --- timing spec from the UI --------------------------------------------

  function timingSpec(animation, phaseKey) {
    var phase = animation && animation[phaseKey];
    var spec = { maxInFraction: Number(el.resolve.value) / 100 };
    if (phase) {
      if (phaseKey === "in") {
        spec.inFraction = phase.fraction;
        spec.inMin = phase.min;
        spec.inMax = phase.max;
      } else {
        spec.outFraction = phase.fraction;
        spec.outMin = phase.min;
        spec.outMax = phase.max;
      }
    }
    return spec;
  }

  function timingsFor(caption, animation) {
    var duration = caption.end - caption.start;
    var spec = timingSpec(animation, "in");
    var outSpec = timingSpec(animation, "out");
    spec.outFraction = outSpec.outFraction;
    spec.outMin = outSpec.outMin;
    spec.outMax = outSpec.outMax;
    if (!animation || !animation.out) spec.hasOut = false;
    return timing.computeTimings(duration, spec);
  }

  // --- file picking --------------------------------------------------------

  function pickFile() {
    var result = window.cep.fs.showOpenDialog(
      false, false, "Choose audio or video",
      "", ["mp4", "mov", "mkv", "avi", "webm", "wav", "mp3", "m4a", "aac", "flac"]
    );
    if (!result || !result.data || !result.data.length) return;
    state.filePath = result.data[0];
    state.fileName = state.filePath.split(/[\\/]/).pop();
    el["file-name"].textContent = state.fileName;
    el.build.disabled = state.busy;
    log("Selected " + state.fileName);
  }

  function readFileAsBlob(path) {
    var read = window.cep.fs.readFile(path, window.cep.fs.NO_ENCODING);
    if (read.err) throw new Error("Could not read file (error " + read.err + ")");
    var binary = read.data;
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return new Blob([bytes]);
  }

  // --- build ---------------------------------------------------------------

  function build() {
    if (!state.filePath) return;
    setBusy(true);
    setProgress(0, "Reading comp…");

    host("capsetGetCompInfo()")
      .then(function (info) {
        state.compInfo = info;
        log("Comp: " + info.name + " " + info.width + "x" + info.height);
        setProgress(0.02, "Uploading…");
        return backend.transcribe(
          readFileAsBlob(state.filePath),
          state.fileName,
          function (p, stage) { setProgress(0.02 + p * 0.9, stage); }
        );
      })
      .then(function (result) {
        setProgress(0.94, "Segmenting…");
        var out = segmentation.segment(result.words, {
          mode: el.mode.value,
          width: state.compInfo.width,
          height: state.compInfo.height
        });
        if (out.layout) log(out.layout.rationale);
        log(result.words.length + " words → " + out.captions.length + " captions");
        if (!out.captions.length) throw new Error("No speech found in that file.");

        var animation = state.selectedAnimation;
        var captions = out.captions.map(function (caption) {
          return {
            text: caption.text,
            lines: caption.lines,
            start: caption.start,
            end: caption.end,
            timings: timingsFor(caption, animation)
          };
        });

        setProgress(0.97, "Building layers…");
        return host("capsetBuildCaptions(" + hostArg({
          captions: captions,
          animation: animation,
          style: {
            fontSize: Number(el["font-size"].value),
            positionY: Number(el["position-y"].value) / 100
          },
          // Timestamps are relative to the submitted file; the comp's work
          // area may not start at zero.
          timeOffset: state.compInfo.workAreaStart || 0
        }) + ")");
      })
      .then(function (data) {
        setProgress(1, "Done");
        log("Built " + data.created + " caption layers.", "ok");
      })
      .catch(function (err) {
        log(err.message, "err");
      })
      .then(function () { setBusy(false); });
  }

  function replaceAnimation(scope) {
    if (!state.selectedAnimation) {
      log("Pick an animation first.", "err");
      return;
    }
    setBusy(true);
    host("capsetReplaceAnimation(" + hostArg({
      animation: state.selectedAnimation,
      scope: scope,
      timingsById: {}
    }) + ")")
      .then(function (data) {
        log("Replaced animation on " + data.changed + " layer(s).", "ok");
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  function buildController() {
    setBusy(true);
    host("capsetBuildController(" + hostArg({
      style: {
        fontSize: Number(el["font-size"].value),
        positionY: Number(el["position-y"].value) / 100
      }
    }) + ")")
      .then(function (data) {
        log("Controller linked to " + data.linked + " layer(s).", "ok");
        if (data.note) log(data.note);
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- wiring --------------------------------------------------------------

  el.retry.addEventListener("click", checkHealth);
  el.pick.addEventListener("click", pickFile);
  el.build.addEventListener("click", build);
  el["replace-selected"].addEventListener("click", function () { replaceAnimation("selected"); });
  el["replace-all"].addEventListener("click", function () { replaceAnimation("all"); });
  el["build-controller"].addEventListener("click", buildController);
  el.resolve.addEventListener("input", function () {
    el["resolve-value"].textContent = el.resolve.value;
  });
  el.mode.addEventListener("change", function () {
    var hints = {
      smart: "Reads the comp's aspect ratio and picks a layout.",
      word: "One caption per word. Punchy; best for vertical/social.",
      phrase: "Broadcast style — 42 characters per line, up to 2 lines."
    };
    el["mode-hint"].textContent = hints[el.mode.value] || "";
  });

  checkHealth();
  loadAnimations();
  log("Capset panel ready.");
})();
