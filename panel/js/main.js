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
  var config = { updateManifestUrl: null, backendUrl: null };
  var timing = CapsetTiming;
  var segmentation = CapsetSegmentation;
  var srt = CapsetSrt;

  var state = {
    srtPath: null,
    srtName: null,
    animations: [],
    selectedAnimation: null,
    compInfo: null,
    selectedAnimationId: null,
    builtInAnimations: [],
    presets: [],
    userDataDir: null,
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

  // evalScript's callback is not guaranteed to fire. If After Effects puts up
  // a modal dialog, or the host script throws somewhere ExtendScript cannot
  // report, the promise never settles — the panel stays disabled with a
  // spinner and the only way out is closing and reopening it. A timeout turns
  // that into a message the user can act on.
  //
  // Generous on purpose: rendering audio from a long composition is legitimately
  // slow, and cutting off work that was going to succeed is the worse failure.
  var HOST_TIMEOUT_MS = 10 * 60 * 1000;

  function host(call, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(
          "After Effects did not respond. If a dialog is open in After " +
          "Effects, close it and try again."
        ));
      }, timeoutMs || HOST_TIMEOUT_MS);

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      }

      cs.evalScript(call, function (raw) {
        if (raw === "EvalScript error.") {
          finish(reject, new Error("ExtendScript failed. Check the AE console."));
          return;
        }
        var parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          finish(reject, new Error(
            "Unexpected host response: " + String(raw).slice(0, 200)));
          return;
        }
        if (!parsed.ok) finish(reject, new Error(parsed.error || "Host error"));
        else finish(resolve, parsed.data);
      });
    });
  }

  function arg(value) {
    return JSON.stringify(JSON.stringify(value));
  }

  // --- updates -------------------------------------------------------------

  /** The running version, from the CEP manifest rather than a hardcoded copy. */
  function currentVersion() {
    try {
      var found = cs.getExtensions(["design.hazrd.capset.panel"]);
      if (found && found.length && found[0].version) return found[0].version;
    } catch (e) {}
    return "0.0.0";
  }

  function showUpdate(result) {
    var banner = $("update-banner");
    banner.hidden = false;
    banner.className = "update" + (result.required ? " required" : "");
    $("update-title").textContent = result.required
      ? "Update required — " + result.version
      : "Capset " + result.version + " is available";
    $("update-notes").textContent = result.notes || "";
    $("update-get").disabled = !result.url;
    $("update-get").onclick = function () {
      if (result.url) cs.openURLInDefaultBrowser(result.url);
    };
  }

  function checkForUpdates(force) {
    if (!config.updateManifestUrl) return Promise.resolve();
    var checker = new CapsetUpdates.UpdateChecker({
      manifestUrl: config.updateManifestUrl,
      currentVersion: currentVersion()
    });
    return checker.check(force).then(function (result) {
      if (result.status === "update") showUpdate(result);
      // "unavailable" is silent on purpose: being offline is normal and must
      // not read as the plugin being broken.
    });
  }

  function loadConfig() {
    return fetch("capset.config.json")
      .then(function (res) { return res.json(); })
      .then(function (loaded) {
        config.updateManifestUrl = loaded.updateManifestUrl || null;
        if (loaded.backendUrl) {
          backend.baseUrl = loaded.backendUrl;
          // An explicit URL is an override, so stop hunting for the service.
          config.backendUrl = loaded.backendUrl;
        }
      })
      .catch(function () {
        // Missing or malformed config is not fatal — defaults are fine.
      });
  }

  // --- starting the backend ------------------------------------------------

  /**
   * Where the transcription service was installed.
   *
   * The Windows installer lets the user change the install directory, so the
   * path cannot be hardcoded; setup writes it into the extension folder.
   * The fallbacks cover a hand-copied extension or an installer that predates
   * the file, and are the default install locations.
   */
  function backendExecutable() {
    var extension = cs.getSystemPath(SystemPath.EXTENSION);
    try {
      var recorded = readText(extension + "/backend-path.txt").replace(/^\s+|\s+$/g, "");
      if (recorded) return recorded;
    } catch (e) {
      // No file is normal on a hand-installed panel; fall through.
    }
    return cs.getOSInformation().indexOf("Windows") !== -1
      ? "C:\\Program Files\\Capset\\backend\\capset-backend.exe"
      : "/Library/Application Support/Capset/capset-backend";
  }

  /**
   * Launch the service. Throws if it cannot be started, which the launcher
   * turns into a message naming the executable rather than a bare refusal.
   *
   * Deliberately not a login-time autostart: the service holds the speech
   * model in memory, so starting it at boot would cost hundreds of megabytes
   * on machines where After Effects is never opened. Starting it when the
   * panel opens costs nothing the rest of the time.
   */
  function spawnBackend() {
    var exe = backendExecutable();
    if (!window.cep || !window.cep.process || !window.cep.process.createProcess) {
      throw new Error("this build of After Effects cannot launch it");
    }
    var result = window.cep.process.createProcess(exe);
    if (!result || result.err) {
      throw new Error(exe + " (error " + ((result && result.err) || "unknown") + ")");
    }
  }

  // --- backend health ------------------------------------------------------

  /**
   * Ask the host where the backend published its port.
   *
   * Panel JavaScript has no access to environment variables, so the path has
   * to be resolved in ExtendScript. Any failure resolves to null and the
   * default port is used — discovery is an optimisation, never a gate.
   */
  function publishedPort() {
    return host("capsetBackendPort()").catch(function () { return null; });
  }

  function describeHealth(health) {
    if (health.status === "unreachable") {
      // Distinguish "we could not start it" from "we started it and it did
      // not come up" — they need different things from the user.
      setStatus("error", health.error || "The transcription service is not running.");
    } else if (health.model_loaded) {
      setStatus("ok", "Ready — " + ((health.engine || {}).model || "model loaded"));
    } else if (health.model_loading) {
      // The first launch downloads roughly 600 MB. Saying so is the
      // difference between "it is working" and "it is broken".
      setStatus("warn", "Preparing the speech model (one time, ~600 MB)…");
    } else {
      setStatus("error", health.error || "The speech model failed to load.");
    }
    return health;
  }

  /** One connect attempt: rediscover the port, then probe. */
  function probeBackend() {
    if (config.backendUrl) return backend.health();
    return publishedPort().then(function (port) {
      return backend.connect(port ? [port] : []);
    });
  }

  function checkHealth() {
    setStatus("warn", "Checking transcription service…");
    return CapsetLauncher.ensureRunning({
      health: probeBackend,
      spawn: spawnBackend,
      onStarting: function () {
        setStatus("warn", "Starting the transcription service…");
      }
    }).then(describeHealth);
  }

  // --- animations ----------------------------------------------------------

  function loadAnimations() {
    return fetch("animations/animations.json")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        state.builtInAnimations = data.animations || [];
        return loadPresets();
      })
      .then(function () {
        refreshLibrary();
      })
      .catch(function (err) {
        log("Could not load animation library: " + err.message, "err");
      });
  }

  // --- live previews -------------------------------------------------------
  //
  // One requestAnimationFrame loop for the whole grid, not one per card. Only
  // cards that are hovered or selected are sampled, and the loop stops
  // entirely when none are — a panel sitting idle in a corner of After
  // Effects must not burn a core rendering animations nobody is looking at.

  var PREVIEW_TEXT = "make it pop";
  var PREVIEW_DURATION = 1.5;     // seconds of caption
  var PREVIEW_GAP = 0.45;         // pause before looping, so the punch reads

  var previews = [];              // {animation, units[], timings, active}
  var previewFrame = null;

  function previewTimings(animation) {
    var spec = { hasOut: !!(animation && animation.out) };
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
    }
    return timing.computeTimings(PREVIEW_DURATION, spec);
  }

  function drawPreviews(now) {
    previewFrame = null;
    var t = (now / 1000) % (PREVIEW_DURATION + PREVIEW_GAP);
    var running = false;

    for (var i = 0; i < previews.length; i++) {
      var item = previews[i];
      if (!item.active) continue;
      running = true;
      for (var u = 0; u < item.units.length; u++) {
        var state = CapsetPreview.sampleUnit(
          item.animation, item.timings, u, item.units.length,
          Math.min(t, PREVIEW_DURATION)
        );
        var styles = CapsetPreview.stylesFor(state);
        var el = item.units[u];
        el.style.transform = styles.transform;
        el.style.opacity = styles.opacity;
        el.style.filter = styles.filter;
        el.style.letterSpacing = styles.letterSpacing;
        el.style.color = styles.color;
      }
    }
    if (running) previewFrame = requestAnimationFrame(drawPreviews);
  }

  function startPreviews() {
    if (previewFrame === null) previewFrame = requestAnimationFrame(drawPreviews);
  }

  function resetPreview(item) {
    for (var u = 0; u < item.units.length; u++) {
      var el = item.units[u];
      el.style.transform = "";
      el.style.opacity = "";
      el.style.filter = "";
      el.style.letterSpacing = "";
      el.style.color = "";
    }
  }

  function setPreviewActive(item, active) {
    if (item.active === active) return;
    item.active = active;
    if (active) startPreviews();
    else resetPreview(item);
  }

  function buildPreview(animation, thumb) {
    var stage = document.createElement("div");
    stage.className = "stage";
    var units = [];
    var text = animation.basedOn === "words"
      ? PREVIEW_TEXT
      : PREVIEW_TEXT.split(" ")[0];         // characters: one short word fits
    var pieces = CapsetPreview.splitUnits(text, animation.basedOn);

    pieces.forEach(function (piece, index) {
      var span = document.createElement("span");
      // A non-breaking space keeps word gaps while each unit stays its own
      // element — a plain space between inline-blocks collapses.
      span.textContent = piece;
      stage.appendChild(span);
      if (animation.basedOn === "words" && index < pieces.length - 1) {
        stage.appendChild(document.createTextNode("\u00a0"));
      }
      units.push(span);
    });
    thumb.appendChild(stage);
    return { animation: animation, units: units,
             timings: previewTimings(animation), active: false };
  }

  // --- saved presets -------------------------------------------------------
  //
  // Stored in the user's data folder, never in the extension folder: that
  // lives under Program Files, needs elevation to write, and is replaced
  // wholesale on upgrade — presets saved there would vanish with the first
  // update.

  var PRESETS_FILE = "presets.json";

  function presetsPath() {
    if (!state.userDataDir) return null;
    return state.userDataDir +
           (state.userDataDir.indexOf("\\") !== -1 ? "\\" : "/") + PRESETS_FILE;
  }

  function loadPresets() {
    return host("capsetGetUserDataDir()")
      .then(function (dir) {
        state.userDataDir = dir;
        var path = presetsPath();
        var read = window.cep.fs.readFile(path);
        // A missing file is the normal first-run state, not an error.
        state.presets = read.err ? [] : CapsetPresets.parse(read.data);
      })
      .catch(function () {
        // No writable folder: the built-in library still works, saving does
        // not. Say so when they try, not before.
        state.presets = [];
      });
  }

  function writePresets() {
    var path = presetsPath();
    if (!path) throw new Error("No writable folder for presets on this machine.");
    var result = window.cep.fs.writeFile(path, CapsetPresets.serialize(state.presets));
    if (result && result.err) {
      throw new Error("Could not write " + path + " (error " + result.err + ")");
    }
  }

  function refreshLibrary() {
    state.animations = CapsetPresets.merge(state.builtInAnimations, state.presets);
    var keep = state.selectedAnimationId;
    renderAnimations();
    var found = false;
    state.animations.forEach(function (a) { if (a.id === keep) found = true; });
    if (state.animations.length) {
      selectAnimation(found ? keep : state.animations[0].id);
    }
  }

  function savePreset() {
    var name = $("preset-name").value;
    try {
      var preset = CapsetPresets.fromAnimation(state.selectedAnimation, {
        name: name,
        style: $("preset-with-style").checked && state.capturedStyle
          ? state.capturedStyle.style
          : null
      });
      state.presets = CapsetPresets.upsert(state.presets, preset);
      writePresets();
      $("preset-name").value = "";
      state.selectedAnimationId = preset.id;
      refreshLibrary();
      log("Saved preset \"" + preset.name + "\".", "ok");
    } catch (err) {
      log(err.message, "err");
    }
  }

  function deletePreset() {
    var animation = state.selectedAnimation;
    if (!animation || !animation.custom) {
      log("Built-in animations cannot be deleted.", "err");
      return;
    }
    try {
      state.presets = CapsetPresets.remove(state.presets, animation.id);
      writePresets();
      state.selectedAnimationId = null;
      refreshLibrary();
      log("Deleted preset \"" + animation.name + "\".", "ok");
    } catch (err) {
      log(err.message, "err");
    }
  }

  function renderAnimations() {
    var grid = $("animations");
    grid.innerHTML = "";
    previews = [];
    if (previewFrame !== null) {
      cancelAnimationFrame(previewFrame);
      previewFrame = null;
    }

    state.animations.forEach(function (animation) {
      var card = document.createElement("div");
      card.className = "anim";
      card.dataset.id = animation.id;
      card.title = animation.description || animation.name;

      var thumb = document.createElement("div");
      thumb.className = "thumb";
      var item = null;
      if (animation["in"] || animation.out) {
        item = buildPreview(animation, thumb);
        previews.push(item);
      } else {
        thumb.textContent = "—";
      }

      card.addEventListener("mouseenter", function () {
        if (item) setPreviewActive(item, true);
      });
      card.addEventListener("mouseleave", function () {
        if (item && animation.id !== state.selectedAnimationId) {
          setPreviewActive(item, false);
        }
      });

      var label = document.createElement("div");
      label.className = "label";
      label.textContent = animation.name;
      if (animation.custom) {
        // Marked so a saved preset is distinguishable from a shipped one at a
        // glance — they behave differently, only one can be deleted.
        card.classList.add("custom");
        label.title = animation.name + " (your preset)";
      }

      card.appendChild(thumb);
      card.appendChild(label);
      card.addEventListener("click", function () { selectAnimation(animation.id); });
      grid.appendChild(card);
    });
  }

  function selectAnimation(id) {
    state.selectedAnimation = null;
    state.selectedAnimationId = id;
    state.animations.forEach(function (a) {
      if (a.id === id) state.selectedAnimation = a;
    });
    Array.prototype.forEach.call($("animations").children, function (card) {
      card.className = card.dataset.id === id ? "anim selected" : "anim";
    });
    // The chosen animation keeps playing, so the user can see what they
    // picked without holding the pointer over it. Everything else stops.
    previews.forEach(function (item) {
      setPreviewActive(item, item.animation.id === id);
    });
    var custom = !!(state.selectedAnimation && state.selectedAnimation.custom);
    $("preset-delete").disabled = !custom;
    $("preset-hint").textContent = custom
      ? "This is one of your saved presets."
      : "Saved presets appear in the grid above and live in your user folder, " +
        "so they survive updates.";
  }

  function timingsFor(caption, animation) {
    var duration = caption.end - caption.start;
    var spec = { maxInFraction: Number($("resolve").value) / 100 };
    // A karaoke fill is supposed to run the length of the caption — that IS
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

  /**
   * Get audio without a file dialog: After Effects renders it.
   *
   * Rendering rather than reading the source file means we transcribe what
   * the user actually hears — comp mix, levels, solo/mute, audio effects,
   * time remapping — and it is why no media decoder ships with Capset.
   */
  function renderAudio(scope) {
    setProgress(0.05, "Rendering audio from After Effects…");
    return host("capsetRenderAudio(" + arg({ scope: scope }) + ")")
      .then(function (rendered) {
        log("Rendered audio via “" + rendered.template + "” (" +
            rendered.layers.join(", ") + ")");
        return rendered;
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
    return renderAudio(scope).then(function (source) {
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
        // The render begins at the requested range, so timestamps are
        // relative to that point in comp time.
        return { captions: out.captions, offset: source.start || 0 };
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
    // The comp the style came from is recorded at capture time, so position
    // scales correctly however many comps have been opened since.
    host("capsetSyncStyle(" + arg({
      style: state.capturedStyle.style,
      effects: state.capturedStyle.effects,
      copyEffects: $("opt-effects").checked,
      scope: radio("scope"),
      sourceLayerIndex: state.capturedStyle.sourceLayerIndex,
      sourceCompName: state.capturedStyle.sourceCompName
    }) + ")")
      .then(function (data) {
        log("Styled " + data.updated + " layer(s) across " +
            data.comps + " comp(s).", "ok");
        if (data.effectsCopied) {
          log("Copied effects onto " + data.effectsCopied + " layer(s).", "ok");
        }
        if (data.effectsLimitedToActiveComp) {
          // After Effects pastes into the active comp, whichever layer is
          // selected, so saying nothing here would leave the user believing
          // effects went everywhere the type did.
          log("Effects were copied in this composition only — After Effects " +
              "can only paste into the composition that is open.", "warn");
        }
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

  $("preset-save").addEventListener("click", savePreset);
  $("preset-delete").addEventListener("click", deletePreset);
  $("preset-name").addEventListener("keydown", function (event) {
    if (event.key === "Enter") savePreset();
  });

  $("update-dismiss").addEventListener("click", function () {
    $("update-banner").hidden = true;
  });

  loadConfig().then(function () { checkForUpdates(false); });
  checkHealth();
  loadAnimations();
  log("Capset panel ready.");
})();
