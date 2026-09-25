/**
 * Panel wiring: three tabs (Insert / Update / Proofread), the backend calls,
 * and the ExtendScript bridge.
 *
 * Segmentation, SRT parsing and the Proofread tab's edits live in js/lib/ and
 * are unit-tested under node. This file is glue and DOM.
 */
(function () {
  "use strict";

  var cs = new CSInterface();
  var backend = new CapsetBackendLib.CapsetBackend();
  var config = { updateManifestUrl: null, backendUrl: null };
  var segmentation = CapsetSegmentation;
  var srt = CapsetSrt;
  var proofread = CapsetProofread;

  var state = {
    srtPath: null,
    srtName: null,
    compInfo: null,
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

  var LOG_MAX_LINES = 500;

  function log(message, kind) {
    var line = document.createElement("div");
    if (kind) line.className = kind;
    var now = new Date();
    line.textContent =
      ("0" + now.getHours()).slice(-2) + ":" +
      ("0" + now.getMinutes()).slice(-2) + ":" +
      ("0" + now.getSeconds()).slice(-2) + "  " + message;
    var box = $("log");
    box.appendChild(line);
    // A long job on a long video logs per chunk and per stage. Without a cap
    // the panel's DOM grows for as long as it is open, and the oldest lines are
    // the least useful ones to keep.
    while (box.children.length > LOG_MAX_LINES) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;

    // The log is closed until wanted, but a warning or an error still has to
    // be seen: it marks the toggle, and the latest one is shown on it, until
    // the log is opened.
    if (box.hidden && (kind === "err" || kind === "warn")) {
      var badge = $("log-badge");
      if (kind === "err" || !badge.classList.contains("err")) {
        badge.className = "log-badge " + kind;
      }
      badge.textContent = message;
      badge.title = message;
      badge.hidden = false;
    }
  }

  var LOG_OPEN_KEY = "capset.logOpen";

  function setLogOpen(open) {
    var box = $("log");
    box.hidden = !open;
    $("log-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    $("log-toggle").title = open ? "Hide the log" : "Show the log";
    if (open) {
      $("log-badge").hidden = true;
      $("log-badge").className = "log-badge";
      box.scrollTop = box.scrollHeight;
    }
    // Remembered per machine for convenience; if storage is unavailable the
    // log simply starts closed.
    try { window.localStorage.setItem(LOG_OPEN_KEY, open ? "1" : "0"); } catch (e) {}
  }

  /**
   * Report the service's state in as little space as it deserves.
   *
   * A healthy backend is the overwhelmingly common case and says nothing the
   * user needs to read, so it is a coloured dot in the tab row and no more.
   * After Effects panels are docked into a column a few hundred pixels wide;
   * a permanent full-width row naming the model was the single largest piece
   * of furniture in the panel and carried the least information in it.
   *
   * Anything that is NOT healthy still gets the full row, with the message
   * and the re-check button, because those are the states the user has to act
   * on. The dot keeps the message as a tooltip either way.
   */
  function setStatus(kind, message) {
    var row = $("status");
    row.className = kind;
    row.querySelector(".msg").textContent = message;
    row.hidden = kind === "ok";

    var dot = $("status-dot");
    dot.className = "status-dot " + kind;
    dot.title = message;
  }

  function setBusy(busy) {
    state.busy = busy;
    var ids = ["build", "pick", "capture", "sync", "clear", "export-srt",
               "pr-refresh", "pr-replace-all", "pr-fix", "pr-earlier", "pr-later"];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.disabled = busy;
    }
    if (!busy && !state.capturedStyle) $("sync").disabled = true;
    // A build replaces the very layers the Proofread list points at, so the
    // list is read-only until it is done and then read again.
    $("pr-list").classList.toggle("locked", busy);
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

  // Port discovery is an optimisation with a fallback, not a gate. See
  // publishedPort().
  var DISCOVERY_TIMEOUT_MS = 2 * 1000;

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
    // Short timeout on purpose. This runs on every health check, including the
    // one at startup, and it has a working fallback (the default port). The
    // 10-minute default belongs to calls that render audio; inheriting it here
    // means a host that never answers leaves the panel apparently frozen for
    // ten minutes over a lookup it was always allowed to skip.
    return host("capsetBackendPort()", DISCOVERY_TIMEOUT_MS)
      .catch(function () { return null; });
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
    return publishedPort().then(function (published) {
      // The same file carries the token the service requires on /jobs. A web
      // page on this machine can reach the service but cannot read this file,
      // which is what stops it driving the panel's backend -- see
      // _require_token in backend/app/main.py.
      backend.token = (published && published.token) || "";
      var port = published && published.port;
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

  // --- file helpers --------------------------------------------------------

  /**
   * Read a rendered audio file as a Blob.
   *
   * `expect` is the size After Effects reported for the file it just wrote.
   * Passing it is not optional in spirit: a read that silently returns
   * something other than the file is the failure that cost v0.2.2 through
   * v0.2.4, and the size check is what makes it impossible to miss again.
   * The reading itself lives in js/lib/cepfile.js so it can be tested against
   * a fake host — this function could not be, and was not.
   */
  function readBlob(path, expect) {
    return new Blob([CapsetCepFile.readBinary(window.cep, path, expect)]);
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

  /**
   * Freeze every user-facing setting at the moment a run starts.
   *
   * The controls deliberately stay live during a run: transcribing a long
   * composition takes minutes, and locking the whole panel for its duration is
   * worse than letting someone set up their next run. But the values used to be
   * READ inside the promise chain, long after the click — so changing the mode
   * dropdown while a transcription was in flight silently changed the captions
   * you got out, with nothing to indicate why. Reading everything once, up
   * front, means what you clicked with is what you get.
   */
  function captureSettings() {
    return {
      source: radio("source"),
      scope: radio("duration"),
      mode: $("mode").value,
      options: {
        precompose: $("opt-precompose").checked,
        parentToController: $("opt-parent").checked
      }
    };
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
        // Naming the layers matters: captions built from the wrong audio, with
        // no indication of which was used, is a miserable thing to debug.
        log((rendered.fromSelection
              ? "Transcribing your selection: "
              : "Transcribing everything audible: ") +
            rendered.layers.join(", "));
        if (!rendered.fromSelection && rendered.layers.length > 1) {
          log("Select just the voice layer for better accuracy — music mixed " +
              "into the audio costs recognition quality.", "warn");
        }
        // Uncompressed PCM is ~176 KB/s at 44.1kHz stereo 16-bit, so a real
        // take is orders of magnitude larger than this. Saying the size out
        // loud makes a bad render visible at the moment it happens, rather
        // than as an empty transcript two steps later.
        // ExtendScript reports -1 for a file it cannot stat; that is "unknown",
        // not "empty", and printing "-0 KB" would be worse than saying nothing.
        if (rendered.bytes > 0) {
          log("Rendered " + Math.round(rendered.bytes / 1024) + " KB of audio.");
        }
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

  /**
   * Say why a transcription came back with nothing.
   *
   * "0 words → 0 captions" is true and useless: it looks like the model
   * failed, when the usual cause is that After Effects handed us audio with
   * nothing in it. Truly silent audio is now rejected in the backend with its
   * own message, so anything reaching here was audible — which makes the level
   * and the duration the two numbers worth showing.
   */
  function explainEmptyTranscript(diagnostics, renderedPath) {
    if (renderedPath) {
      // Kept on purpose in this case, and named so it can be listened to.
      // "Is there actually speech in the file we sent?" is the first question
      // worth answering and the only one the user can answer directly.
      log("The audio is still at " + renderedPath + " — play it to hear " +
          "exactly what was transcribed.", "warn");
    }
    if (!diagnostics) {
      log("No speech was recognised. Check that the layer you selected is " +
          "the one with the dialogue.", "warn");
      return;
    }
    var dbfs = diagnostics.peak > 0
      ? (20 * Math.log10(diagnostics.peak)).toFixed(1) + " dBFS peak"
      : "digital silence";
    log("Transcribed " + diagnostics.duration_sec.toFixed(1) + "s at " +
        diagnostics.sample_rate + " Hz (" + dbfs + ").", "warn");
    if (typeof diagnostics.source_format === "string" && diagnostics.source_format) {
      log("Source: " + diagnostics.source_format + "; " +
          diagnostics.speech_spans + " speech span(s), " +
          diagnostics.chunks + " chunk(s) sent to the model.", "warn");
    }
    if (diagnostics.peak < 0.01) {
      log("That audio is very quiet, which is the most likely reason nothing " +
          "was recognised. Check the layer's audio levels.", "warn");
    } else {
      log("The audio is at a healthy level, so the speech itself was not " +
          "recognised — check you selected the dialogue layer rather than " +
          "music, and that the language is English.", "warn");
    }
  }

  /**
   * Did the backend transcribe the audio we actually rendered?
   *
   * `capsetRenderAudio` knows how long the render was; the backend reports how
   * long the file it decoded turned out to be. When those disagree the audio
   * was damaged between the two, which is exactly what happened in v0.2.4 --
   * a 30s render arrived as 22.2s and the mismatch sat in the log for four
   * releases with nobody reading it as a symptom. Now it says so out loud.
   *
   * Tolerance is generous on purpose: a frame or two of difference is normal
   * rounding between AE's timeline and a sample count, and a false alarm here
   * would train the user to ignore the one message that matters.
   */
  function checkTranscribedDuration(source, diagnostics) {
    if (!diagnostics || !source || !(source.duration > 0)) return;
    var drift = Math.abs(diagnostics.duration_sec - source.duration);
    if (drift < Math.max(0.25, source.duration * 0.02)) return;
    log("After Effects rendered " + source.duration.toFixed(1) + "s but the " +
        "transcriber read " + diagnostics.duration_sec.toFixed(1) + "s. The " +
        "audio was damaged on the way in — captions from it would be wrong. " +
        "Please report this.", "err");
  }

  /**
   * Throw away the audio After Effects rendered, now that it has been read.
   *
   * Fire-and-forget: the captions are already in hand, and a temp file that
   * outlives its usefulness is not worth failing a run over or interrupting
   * the user about. The host refuses anything that is not one of our own
   * renders in the temp folder.
   */
  function discardRender(path) {
    if (!path) return;
    host("capsetDiscardRender(" + arg({ path: path }) + ")")
      .then(null, function () { /* a stale temp file is not the user's problem */ });
  }

  function captionsFromTranscription(settings) {
    return renderAudio(settings.scope).then(function (source) {
      setProgress(0.08, "Sending audio to the transcriber…");
      var name = source.path.split(/[\\/]/).pop();
      // The service runs on this machine, so hand it the path and let it open
      // the file itself: no read into the panel, no base64 decode, no
      // multipart body, no second copy on the service's side. An hour of
      // 48 kHz stereo is ~690 MB, and the upload route holds several copies of
      // it at once. Reading it in the panel stays as the fallback for a
      // service that somehow is not local.
      var payload = backend.isLocal()
        ? { path: source.path }
        : readBlob(source.path, source.bytes);
      return backend.transcribe(
        payload, name,
        function (p, stage) { setProgress(0.08 + p * 0.82, stage); }
      ).then(function (result) {
        checkTranscribedDuration(source, result.diagnostics);
        var out = segmentation.segment(result.words, {
          mode: settings.mode,
          width: state.compInfo.width,
          height: state.compInfo.height
        });
        if (out.layout) log(out.layout.rationale);
        log(result.words.length + " words → " + out.captions.length + " captions");
        if (result.words.length) {
          // Only once there is something to show for it. An empty transcript
          // is the one case where the rendered audio is worth keeping: it is
          // the evidence, and explainEmptyTranscript says where to find it.
          discardRender(source.path);
        } else {
          explainEmptyTranscript(result.diagnostics, source.path);
        }
        // The render begins at the requested range, so timestamps are
        // relative to that point in comp time.
        return {
          captions: out.captions,
          offset: source.start || 0,
          // Only a work-area run is a partial rebuild, and only a partial
          // rebuild may leave existing captions standing. A full-composition
          // run replaces the lot, which is what it has always done.
          range: settings.scope === "inout"
            ? { start: source.start || 0, duration: source.duration }
            : null,
          // Derived from the radio, where the range is derived from what the
          // render actually produced. Two separate sources for the same
          // decision is the point: the host compares them, and a range that
          // goes missing on the way there stops the run instead of quietly
          // turning it into a full replace.
          scoped: settings.scope === "inout"
        };
      });
    });
  }

  function build() {
    var settings = captureSettings();
    setBusy(true);
    setProgress(0, "Reading composition…");

    host("capsetGetCompInfo()")
      .then(function (info) {
        state.compInfo = info;
        log("Comp: " + info.name + " " + info.width + "×" + info.height);
        return settings.source === "file"
          ? captionsFromSrt()
          : captionsFromTranscription(settings);
      })
      .then(function (payload) {
        setProgress(0.94, "Building layers…");
        var captions = payload.captions.map(function (caption) {
          return {
            text: caption.text,
            lines: caption.lines,
            start: caption.start,
            end: caption.end
          };
        });
        return host("capsetBuildCaptions(" + arg({
          captions: captions,
          // Deliberately none: nothing in the panel applies an animation any
          // more. capsetBuildCaptions guards on this being null, and the
          // animator machinery it guards is still there for the rebuilt
          // animation feature — see panel/dormant/README.md.
          animation: null,
          style: {},
          options: settings.options,
          timeOffset: payload.offset,
          // Null unless this run captioned the work area only. The host
          // replaces every caption layer when it is null -- so it is also
          // told which kind of run this was, and refuses rather than
          // replacing everything if the two disagree.
          replaceRange: payload.range || null,
          // Not settings.scope: an SRT import replaces the whole composition
          // whatever the Duration radio says, so only the path that built a
          // range may claim to be scoped.
          scoped: !!payload.scoped
        }) + ")");
      })
      .then(function (data) {
        setProgress(1, "Done");
        var parts = ["Built " + data.created + " caption layers"];
        if (data.replaced) {
          parts.push("replaced " + data.replaced +
                     (data.ranged
                        ? " in " + data.rangeStart.toFixed(2) + "s-" +
                          (data.rangeStart + data.rangeDuration).toFixed(2) + "s"
                        : " (whole composition)"));
        }
        if (data.precomposed) parts.push("precomposed");
        if (data.parented) parts.push("parented to controller");
        log(parts.join(", ") + ".", "ok");
        if (data.precompOverrun) {
          // Worth interrupting for: captions outside the work area were lost,
          // and the user asked for the opposite.
          log("The captions already here were precomposed, so all of them " +
              "were replaced — a work-area rebuild can only leave loose " +
              "caption layers standing.", "warn");
        }
      })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- srt export ----------------------------------------------------------

  /**
   * Export what is on the timeline, not what was transcribed.
   *
   * The host reads the caption layers; js/lib/srt.js turns them into SRT; the
   * host writes the file. Formatting stays on this side because the timecode
   * arithmetic is worth testing and ExtendScript is where tests are hardest
   * to run.
   */
  function exportSrt() {
    setBusy(true);
    host("capsetCaptionsForExport()")
      .then(function (data) {
        var text = srt.format(data.captions);
        if (!text) throw new Error("Those caption layers have no text in them.");
        log(data.captions.length + " captions → SRT");
        return host("capsetWriteSrt(" + arg({
          text: text, name: data.comp
        }) + ")");
      })
      .then(function (data) { log("Wrote " + data.path, "ok"); })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- update tab ----------------------------------------------------------

  function capture() {
    setBusy(true);
    // Refresh the comp info rather than trusting whatever the last build left
    // behind. These dimensions are what a later Sync scales the style by, and
    // state.compInfo is null until the first build and stale after switching
    // comps -- so capturing from a 9:16 comp could record a 16:9 comp's size
    // and silently mis-scale every layer it was later synced onto.
    host("capsetGetCompInfo()")
      .then(function (info) {
        state.compInfo = info;
        return host("capsetCaptureStyle()");
      })
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
        if (data.controllersUpdated) {
          // Font Size, Fill Color, Stroke and Tracking are driven through the
          // Capset Controller's own sliders once a caption is parented to it,
          // so those values were written there instead of onto each layer --
          // writing them onto a linked layer would have been overridden by
          // its own expression on the next frame.
          log("Updated " + data.controllersUpdated + " Capset Controller(s) too.", "ok");
        }
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
    // The one irreversible-feeling action in the panel, one click from the
    // button that builds them. After Effects' own undo does cover it, but a
    // user who has just spent ten minutes styling captions should not discover
    // that by accident.
    if (!window.confirm(
      "Remove every Capset caption layer and the controller from this project?"
    )) return;
    setBusy(true);
    host("capsetClearCaptions(" + arg({ removeController: true }) + ")")
      .then(function (data) { log("Removed " + data.removed + " layer(s).", "ok"); })
      .catch(function (err) { log(err.message, "err"); })
      .then(function () { setBusy(false); });
  }

  // --- proofread tab -------------------------------------------------------
  //
  // Every caption in the comp, stacked in time order, with its text and its
  // in and out timecodes editable in place. What an edit IS lives in
  // js/lib/proofread.js; this is the list, the keys, and the host calls.
  //
  // Edits run one at a time through a queue. Nudging a timecode three times
  // in quick succession is three edits, and each one has to be built from
  // what the one before it left -- or the host would rightly refuse the
  // second as stale.

  var proof = {
    comp: null,        // capsetProofreadList's comp: rate, drop-frame, start
    rows: [],          // the captions, in time order
    issues: [],        // findIssues(rows), row for row
    selected: null,    // key of the selected row, for Shift from here
    issuesOnly: false,
    rendering: false,
    queue: Promise.resolve()
  };

  /** Run proofreading work in order, after whatever is already queued. */
  function enqueue(fn) {
    var next = proof.queue.then(function () { return fn(); });
    proof.queue = next.then(null, function () {});
    return next;
  }

  function rowKey(ref) {
    return ref.compId + ":" + (ref.layerId !== null && ref.layerId !== undefined
      ? "id" + ref.layerId
      : "ix" + ref.index);
  }

  function rowIndex(key) {
    for (var i = 0; i < proof.rows.length; i++) {
      if (rowKey(proof.rows[i].ref) === key) return i;
    }
    return -1;
  }

  function rowByKey(key) {
    var i = rowIndex(key);
    return i === -1 ? null : proof.rows[i];
  }

  function sortRows() {
    proof.rows.sort(function (a, b) { return (a.start - b.start) || (a.end - b.end); });
  }

  /** Read the captions off the timeline. Not queued: callers queue it. */
  function readProofList() {
    return host("capsetProofreadList()")
      .then(function (data) {
        proof.comp = data.comp;
        proof.rows = data.captions;
        sortRows();
        renderProofread();
      })
      .catch(function (err) {
        // Usually "Select a composition first." -- worth showing in the
        // tab, where it explains the empty list, rather than in the log
        // every time the panel regains focus.
        proof.comp = null;
        proof.rows = [];
        renderProofread(err.message);
      });
  }

  function loadProofread() {
    return enqueue(readProofList);
  }

  function proofTabActive() {
    var tab = document.querySelector('.tab[data-tab="proofread"]');
    return !!tab && tab.classList.contains("active");
  }

  /**
   * A refused or failed edit: say why, and read the list again, because the
   * usual reason is that the timeline no longer matches it.
   */
  function proofFailed(err) {
    log(err.message, "err");
    return readProofList();
  }

  function proofReady() {
    if (state.busy) {
      log("Wait for the current run to finish before editing captions.", "warn");
      return false;
    }
    if (!proof.comp) {
      log("No captions have been read yet. Open a composition and press ↻.", "warn");
      return false;
    }
    return true;
  }

  /** Send edits to the host, then put what it reports back into the list. */
  function applyProof(edits, label) {
    return host("capsetProofreadApply(" + arg({ label: label, edits: edits }) + ")")
      .then(function (data) {
        for (var i = 0; i < data.rows.length; i++) {
          var at = rowIndex(rowKey(data.rows[i].ref));
          if (at !== -1) proof.rows[at] = data.rows[i];
        }
        sortRows();
        renderProofread();
        return data;
      })
      .catch(function (err) {
        return proofFailed(err).then(function () { return null; });
      });
  }

  // --- rendering the list ---------------------------------------------------

  /**
   * Where the cursor is, so rebuilding the list does not throw it away. A
   * field with typing in it that has not been saved keeps the typing.
   */
  function captureProofFocus() {
    var el = document.activeElement;
    if (!el || !$("pr-list").contains(el) || !el.dataset.field) return null;
    var row = el.closest(".pr-row");
    return row && {
      key: row.dataset.key,
      field: el.dataset.field,
      dirty: el.value !== el.dataset.orig,
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd
    };
  }

  function restoreProofFocus(saved) {
    if (!saved) return;
    var rows = $("pr-list").children;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.key !== saved.key) continue;
      var el = rows[i].querySelector('[data-field="' + saved.field + '"]');
      if (!el) return;
      if (saved.dirty) el.value = saved.value;
      el.focus();
      try { el.setSelectionRange(saved.start, saved.end); } catch (e) {}
      return;
    }
  }

  /** Size every caption box to its text, reading layout once, not per box. */
  function fitProofText() {
    var boxes = $("pr-list").querySelectorAll("textarea");
    var i;
    for (i = 0; i < boxes.length; i++) boxes[i].style.height = "auto";
    var heights = [];
    for (i = 0; i < boxes.length; i++) heights.push(boxes[i].scrollHeight);
    for (i = 0; i < boxes.length; i++) boxes[i].style.height = (heights[i] + 2) + "px";
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function timecodeField(row, which) {
    var input = make("input", "pr-tc");
    input.type = "text";
    input.spellcheck = false;
    input.dataset.field = which;
    input.value = proofread.formatTimecode(row[which], proof.comp);
    input.dataset.orig = input.value;
    input.title = (which === "start" ? "In" : "Out") + " point. Type a timecode " +
                  "and press Enter; ↑ ↓ nudge a frame, Shift for ten.";
    return input;
  }

  /**
   * One caption: its text, with its in and out times stacked to the right.
   *
   * Deliberately quiet. A list of captions should read like the transcript,
   * so the fields carry no boxes until they are pointed at, and a problem is
   * a coloured edge with the reason on hover rather than another line of
   * furniture per row.
   */
  function buildProofRow(row, issues) {
    var node = make("div", "pr-row");
    node.dataset.key = rowKey(row.ref);
    if (node.dataset.key === proof.selected) node.classList.add("selected");
    if (issues.length) {
      node.classList.add("flagged");
      node.title = issues.map(function (issue) { return issue.message; }).join("\n");
    }

    var text = make("textarea", "pr-text");
    text.rows = 1;
    text.spellcheck = true;
    text.dataset.field = "text";
    text.value = row.text;
    text.dataset.orig = row.text;
    node.appendChild(text);

    var times = make("div", "pr-times");
    times.title = proofread.formatDuration(row.end - row.start) + " on screen";
    times.appendChild(timecodeField(row, "start"));
    times.appendChild(timecodeField(row, "end"));
    node.appendChild(times);

    var actions = make("div", "pr-actions");
    [["go", "Go to", "Move the playhead here and select the layer"],
     ["split", "Split", "Split into two captions where the text cursor is"],
     ["merge", "Merge ↓", "Merge with the caption after this one"]
    ].forEach(function (spec) {
      var button = make("button", "", spec[1]);
      button.dataset.action = spec[0];
      button.title = spec[2];
      actions.appendChild(button);
    });
    node.appendChild(actions);
    return node;
  }

  function renderProofread(message) {
    var list = $("pr-list");
    var saved = captureProofFocus();
    var comp = proof.comp;

    proof.issues = comp ? proofread.findIssues(proof.rows, comp) : [];
    var flagged = 0;
    for (var f = 0; f < proof.issues.length; f++) if (proof.issues[f].length) flagged++;
    if (!flagged) proof.issuesOnly = false;

    var chip = $("pr-issues");
    chip.textContent = flagged ? "⚠ " + flagged + " to check" : "No problems";
    chip.classList.toggle("has-issues", flagged > 0);
    chip.setAttribute("aria-pressed", proof.issuesOnly ? "true" : "false");
    chip.disabled = !flagged;

    var query = $("pr-find").value;
    var matching = null;
    if (query) {
      matching = {};
      var hits = proofread.find(proof.rows, query, $("pr-match-case").checked);
      for (var h = 0; h < hits.length; h++) matching[hits[h]] = true;
    }

    proof.rendering = true;
    var fragment = document.createDocumentFragment();
    var shown = 0;
    for (var i = 0; i < proof.rows.length; i++) {
      if (matching && !matching[i]) continue;
      if (proof.issuesOnly && !proof.issues[i].length) continue;
      fragment.appendChild(buildProofRow(proof.rows[i], proof.issues[i]));
      shown++;
    }
    list.innerHTML = "";
    list.appendChild(fragment);
    proof.rendering = false;

    var head = comp
      ? comp.name + " · " + proof.rows.length + " caption" + (proof.rows.length === 1 ? "" : "s")
      : (message || "Open this tab with a composition active.");
    if (comp && shown !== proof.rows.length) head += " · " + shown + " shown";
    $("pr-comp").textContent = head;

    var empty = $("pr-empty");
    empty.hidden = shown > 0;
    empty.textContent = !comp
      ? (message || "")
      : !proof.rows.length
        ? "No Capset captions in “" + comp.name + "” yet."
        : proof.issuesOnly
          ? "No caption with a problem matches. Press “⚠ to check” to search them all."
          : "No captions match.";

    fitProofText();
    restoreProofFocus(saved);
  }

  function selectProofRow(key) {
    proof.selected = key;
    var rows = $("pr-list").children;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("selected", rows[i].dataset.key === key);
    }
  }

  // --- editing a row --------------------------------------------------------

  function commitProofText(box) {
    var key = box.closest(".pr-row").dataset.key;
    var typed = box.value;
    if (typed === box.dataset.orig) return;
    if (!proofReady()) {
      box.value = box.dataset.orig;
      return;
    }
    // Clean from here on: whatever happens next, this typing has been dealt
    // with, and a rebuild of the list must not carry it over again.
    box.dataset.orig = typed;
    enqueue(function () {
      var row = rowByKey(key);
      if (!row) return;
      var result = proofread.retext(row, typed);
      if (!result) return;
      if (result.error) {
        log(result.error, "err");
        renderProofread();
        return;
      }
      return applyProof([result.edit], "text");
    });
  }

  /** Commit a timecode field: what was typed, or a nudge of `frames`. */
  function commitProofTime(input, frames) {
    var key = input.closest(".pr-row").dataset.key;
    var which = input.dataset.field;
    var typed = input.value;
    if (!frames && typed === input.dataset.orig) return;
    if (!proofReady()) {
      input.value = input.dataset.orig;
      return;
    }
    input.dataset.orig = typed;
    enqueue(function () {
      var row = rowByKey(key);
      if (!row) return;
      var seconds;
      if (frames) {
        seconds = row[which] + frames * proof.comp.frameDuration;
      } else {
        var parsed = proofread.parseTimecode(typed, proof.comp, row[which]);
        if (parsed.error) {
          log(parsed.error, "err");
          renderProofread();
          return;
        }
        seconds = parsed.seconds;
      }
      var result = proofread.retime(row, which, seconds, proof.comp);
      if (!result || result.error) {
        if (result) log(result.error, "err");
        renderProofread();
        return;
      }
      return applyProof([result.edit], "time");
    });
  }

  function focusNextText(row) {
    var next = row.nextElementSibling;
    var box = next && next.querySelector("textarea");
    if (box) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
      box.scrollIntoView({ block: "nearest" });
    } else {
      document.activeElement.blur();
    }
  }

  function revealProofRow(key) {
    enqueue(function () {
      var row = rowByKey(key);
      if (!row) return;
      return host("capsetProofreadReveal(" + arg({ ref: row.ref, time: row.start }) + ")")
        .then(function (data) {
          if (!data.selected) {
            log("That caption is no longer in this composition.", "warn");
            return readProofList();
          }
        })
        .catch(proofFailed);
    });
  }

  function splitProofRow(key, box) {
    if (!proofReady()) return;
    if (document.activeElement !== box) {
      log("Click in the caption's text where it should split, then press Split.", "warn");
      return;
    }
    // Split what is in the box, typing and all: both halves are written, so
    // anything not yet saved goes in with them.
    var typed = box.value;
    var at = box.selectionStart;
    box.dataset.orig = typed;
    enqueue(function () {
      var row = rowByKey(key);
      if (!row) return;
      var parts = proofread.splitAt(
        { ref: row.ref, text: typed, start: row.start, end: row.end }, at, proof.comp
      );
      if (parts.error) { log(parts.error, "err"); return; }
      return host("capsetProofreadSplit(" + arg({
        ref: row.ref,
        expect: proofread.expectOf(row),
        first: parts.first,
        second: parts.second
      }) + ")")
        .then(function () {
          log("Split at " + proofread.formatTimecode(parts.second.start, proof.comp) + ".", "ok");
          return readProofList();
        })
        .catch(proofFailed);
    });
  }

  function mergeProofRow(key, box) {
    if (!proofReady()) return;
    // Save any typing first, so the merge joins what is on screen.
    if (box.value !== box.dataset.orig) commitProofText(box);
    enqueue(function () {
      var i = rowIndex(key);
      if (i === -1) return;
      var a = proof.rows[i];
      var b = proof.rows[i + 1];
      if (!b) {
        log("That is the last caption; there is nothing after it to merge.", "warn");
        return;
      }
      var merged = proofread.merge(a, b);
      return host("capsetProofreadMerge(" + arg({
        ref: a.ref,
        expect: proofread.expectOf(a),
        next: { ref: b.ref, expect: proofread.expectOf(b) },
        text: merged.text,
        start: merged.start,
        end: merged.end
      }) + ")")
        .then(function () {
          log("Merged the captions at " + proofread.formatTimecode(a.start, proof.comp) +
              " and " + proofread.formatTimecode(b.start, proof.comp) + ".", "ok");
          return readProofList();
        })
        .catch(proofFailed);
    });
  }

  // --- the tools above the list ---------------------------------------------

  function replaceAllProof() {
    if (!proofReady()) return;
    // Read at the click, like every other run setting.
    var query = $("pr-find").value;
    var replacement = $("pr-replace").value;
    var matchCase = $("pr-match-case").checked;
    enqueue(function () {
      var out = proofread.replaceAll(proof.rows, query, replacement, matchCase);
      if (out.error) { log(out.error, "err"); return; }
      if (!out.edits.length) { log("Nothing to replace.", "warn"); return; }
      return applyProof(out.edits, "replace").then(function (data) {
        if (!data) return;
        log("Replaced " + out.count + " occurrence" + (out.count === 1 ? "" : "s") +
            " in " + out.edits.length + " caption" + (out.edits.length === 1 ? "" : "s") +
            ".", "ok");
      });
    });
  }

  function fixProofOverlaps() {
    if (!proofReady()) return;
    enqueue(function () {
      var out = proofread.fixOverlaps(proof.rows, proof.comp);
      var unfixed = function () {
        if (!out.unfixed.length) return;
        log(out.unfixed.length + " caption" + (out.unfixed.length === 1 ? " starts" : "s start") +
            " at the same moment as the next one (" +
            out.unfixed.map(function (i) {
              return proofread.formatTimecode(proof.rows[i].start, proof.comp);
            }).join(", ") +
            "). Retime or merge those by hand.", "warn");
      };
      if (!out.edits.length) {
        if (!out.unfixed.length) log("Nothing overlaps.", "ok");
        unfixed();
        return;
      }
      return applyProof(out.edits, "fix").then(function (data) {
        if (!data) return;
        log("Fixed " + out.edits.length + " caption" + (out.edits.length === 1 ? "" : "s") + ".", "ok");
        unfixed();
      });
    });
  }

  function shiftProof(direction) {
    if (!proofReady()) return;
    var frames = Math.abs(parseInt($("pr-shift-frames").value, 10)) || 0;
    var fromSelected = $("pr-shift-from").checked;
    var selected = proof.selected;
    enqueue(function () {
      var from = 0;
      if (fromSelected) {
        from = selected ? rowIndex(selected) : -1;
        if (from === -1) {
          log("Click a caption first; the shift starts from the selected one.", "warn");
          return;
        }
      }
      var out = proofread.shift(proof.rows, from, direction * frames, proof.comp);
      if (out.error) { log(out.error, "err"); return; }
      return applyProof(out.edits, "shift").then(function (data) {
        if (!data) return;
        log("Moved " + out.edits.length + " caption" + (out.edits.length === 1 ? "" : "s") +
            " " + frames + " frame" + (frames === 1 ? "" : "s") +
            (direction < 0 ? " earlier." : " later."), "ok");
      });
    });
  }

  function wireProofread() {
    var list = $("pr-list");

    list.addEventListener("focusin", function (event) {
      var row = event.target.closest(".pr-row");
      if (row) selectProofRow(row.dataset.key);
      if (event.target.classList.contains("pr-tc")) event.target.select();
    });

    list.addEventListener("focusout", function (event) {
      if (proof.rendering) return;
      var field = event.target.dataset.field;
      if (field === "text") commitProofText(event.target);
      else if (field === "start" || field === "end") commitProofTime(event.target, 0);
    });

    list.addEventListener("keydown", function (event) {
      var target = event.target;
      var field = target.dataset.field;
      if (!field) return;
      if (event.key === "Escape") {
        target.value = target.dataset.orig;
        target.blur();
        event.preventDefault();
        return;
      }
      if (field === "text") {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commitProofText(target);
          focusNextText(target.closest(".pr-row"));
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitProofTime(target, 0);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        var step = event.shiftKey ? 10 : 1;
        commitProofTime(target, event.key === "ArrowUp" ? step : -step);
      }
    });

    list.addEventListener("input", function (event) {
      if (event.target.dataset.field !== "text") return;
      event.target.style.height = "auto";
      event.target.style.height = (event.target.scrollHeight + 2) + "px";
    });

    // The row buttons act on the caption being typed in, so pressing one
    // must not take the cursor out of it: that would save the text on the
    // way past, and lose the split point.
    list.addEventListener("mousedown", function (event) {
      if (event.target.dataset.action) event.preventDefault();
    });

    list.addEventListener("click", function (event) {
      var row = event.target.closest(".pr-row");
      if (!row) return;
      selectProofRow(row.dataset.key);
      var action = event.target.dataset.action;
      var box = row.querySelector("textarea");
      if (action === "go") revealProofRow(row.dataset.key);
      else if (action === "split") splitProofRow(row.dataset.key, box);
      else if (action === "merge") mergeProofRow(row.dataset.key, box);
    });

    $("pr-refresh").addEventListener("click", loadProofread);
    $("pr-find").addEventListener("input", function () { renderProofread(); });
    $("pr-match-case").addEventListener("change", function () { renderProofread(); });
    $("pr-replace-toggle").addEventListener("click", function () {
      var row = $("pr-replace-row");
      row.hidden = !row.hidden;
      $("pr-replace-toggle").setAttribute("aria-expanded", row.hidden ? "false" : "true");
      if (!row.hidden) $("pr-replace").focus();
    });
    $("pr-replace-all").addEventListener("click", replaceAllProof);
    $("pr-issues").addEventListener("click", function () {
      proof.issuesOnly = !proof.issuesOnly;
      renderProofread();
    });
    $("pr-fix").addEventListener("click", fixProofOverlaps);
    $("pr-earlier").addEventListener("click", function () { shiftProof(-1); });
    $("pr-later").addEventListener("click", function () { shiftProof(1); });

    // Captions change behind the panel's back -- an undo, a layer dragged in
    // the timeline, another comp opened -- and there is no event for any of
    // it. Coming back to the panel is the moment someone is about to read
    // the list, so that is when it is read again.
    window.addEventListener("focus", function () {
      if (proofTabActive() && !state.busy) loadProofread();
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (proofTabActive()) fitProofText(); }, 100);
    });
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
      // Read afresh every time the tab opens: the captions may have been
      // rebuilt, retimed or undone since it was last looked at.
      if (tab.dataset.tab === "proofread") loadProofread();
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
  $("status-dot").addEventListener("click", checkHealth);
  $("pick").addEventListener("click", pickSrt);
  $("build").addEventListener("click", build);
  $("capture").addEventListener("click", capture);
  $("sync").addEventListener("click", sync);
  $("clear").addEventListener("click", clearCaptions);
  $("export-srt").addEventListener("click", exportSrt);
  wireProofread();
  $("mode").addEventListener("change", function () {
    // Three are offered. The rest still resolve in js/lib/segmentation.js,
    // because they are real modes and a project saved by an earlier version
    // can name one — they simply are not choices worth putting in front of
    // someone captioning a video.
    var hints = {
      smart: "Sizes captions to the comp, cutting where the speaker pauses.",
      one: "One caption per word. Punchy; best for vertical/social.",
      word: "One caption per word. Punchy; best for vertical/social.",
      two: "Two words per caption — balanced rhythm and readability.",
      three: "Three words per caption — smoother pacing, fewer cuts.",
      parts: "Groups 2–5 words on the pauses in the speech.",
      sentence: "One caption per sentence, cut on the speaker's punctuation.",
      phrase: "Broadcast style — 42 characters per line, up to 2 lines."
    };
    $("mode-hint").textContent = hints[$("mode").value] || "";
  });

  $("log-toggle").addEventListener("click", function () {
    setLogOpen($("log").hidden);
  });
  (function () {
    var open = false;
    try { open = window.localStorage.getItem(LOG_OPEN_KEY) === "1"; } catch (e) {}
    setLogOpen(open);
  })();

  $("update-dismiss").addEventListener("click", function () {
    $("update-banner").hidden = true;
  });

  loadConfig().then(function () { checkForUpdates(false); });
  checkHealth();
  log("Capset panel ready.");
})();
