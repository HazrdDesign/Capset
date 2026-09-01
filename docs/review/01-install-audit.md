# Capset install/packaging audit

Scope: everything between "buyer downloads the .exe" and "captions appear in
After Effects," judged against *works after a plain double-click install, no
terminal, no Task Manager, no manual steps*. Six releases have already
shipped broken on six different packaging problems (relative imports,
onnxruntime not collected, huggingface_hub not collected, `sys.stdout=None`,
locked files on upgrade — plus port handling already flagged as open debt).
This is a search for the next ones, not a re-litigation of the fixed five,
though I verified each of those fixes actually holds.

Every finding below was traced through the actual code paths, and several
were checked against the real installed packages (`onnx-asr` 0.12.0,
`huggingface_hub` 1.29.0, `hf_xet` 1.6.0) rather than assumed.

---

## CRITICAL — will break for users

### C1. Model loading blocks the entire event loop — `/health` doesn't just degrade, it stops answering at all, for the whole first-run download

- `backend/app/main.py:45-56` — `lifespan()` calls `transcriber.load()` directly, with no `await`, no `asyncio.to_thread`, no executor.
- `backend/app/transcribe.py:34-35` — `Transcriber.load()` is a plain synchronous call into the engine.
- `backend/app/engines/onnx_asr_engine.py:64-102` — `OnnxAsrEngine.load()` calls `onnx_asr.load_model()`, which (via `resolver.py`) calls `huggingface_hub.hf_hub_download`/`snapshot_download` synchronously — blocking socket I/O, not `await`-based.
- `backend/app/main.py:157-171` — `uvicorn.run(app, ...)` with no `workers=`, i.e. one process, one asyncio event loop, one OS thread.

FastAPI/Starlette only starts serving `'http'`-scope requests through the
same event loop that runs the `'lifespan'` startup coroutine. Asyncio is
cooperatively single-threaded: a plain synchronous call blocks that thread
completely until it returns, so *nothing else on that loop can run* —
including accepting/servicing any other connection — while it's blocked.
`transcriber.load()` is exactly such a call, and on first run it includes
the ~600 MB Hugging Face download plus ONNX session construction for a
600M-parameter model.

**What the user actually sees:** they open the panel; `panel/js/lib/backend.js:30-47` fires a plain `fetch("/health")` with no timeout/AbortController; `panel/js/main.js:148-159` sets the status line to "Checking transcription service…" and awaits the promise. The TCP connection to 127.0.0.1:8756 succeeds immediately (the socket is already listening), but no HTTP response ever comes back until `transcriber.load()` returns — because the process literally cannot service the request until then. So the panel sits on "Checking transcription service…" indefinitely, with **zero progress indication that a 600 MB download is even happening**, for however long that download takes (minutes on a typical connection, much longer on a slow one). This is worse than "degraded" or "unreachable" — those states are only reachable *after* `lifespan.startup()` returns, and it cannot return while blocked. It looks exactly like a hung/frozen plugin.
- This directly contradicts `docs/RELEASE-NOTES-v0.1.md:70-73`'s own framing ("Skipping it just moves the wait to the first transcription") — the actual behavior is not a wait *before* transcription, it's the *entire service* (including the health check the panel uses to explain itself) going dark.
- It also affects every ordinary restart, not just first-run: any time the ONNX session construction for a 600 MB model takes more than an instant, `/health` is unreachable for that whole window. Normally short, but not zero, and worth knowing this same mechanism is what's firing.

**Fix direction (not implemented, just flagged):** run `transcriber.load()` via `await asyncio.get_running_loop().run_in_executor(None, transcriber.load)` inside `lifespan()`, or start it as a background task and let `/health` report "loading" (which the code already has a slot for) while requests keep being served.

### C2. Nothing restarts the backend — on reboot, or ever, the panel just tells the user to do something it never explains how to do

- `installer/windows/capset.iss:103-105` — the only thing that ever starts `capset-backend.exe` is a one-shot `[Run]` entry (`Flags: nowait postinstall skipifsilent runhidden`) executed once, at the end of Setup.
- No Windows Service registration (`sc.exe create`), no Scheduled Task ("run at logon"), no Startup-folder shortcut. `[Icons]` (`capset.iss:72-74`) only creates a Start Menu shortcut, not an autostart entry.
- `panel/js/main.js:154` — when the backend isn't reachable, the message is literally `"Service not running. Start the Capset backend."` — it does not say *how*.
- `panel/js/main.js:476,502` — the only remediation in the UI is a "↻ Retry" button that re-runs the same health check; it does not start the process.
- Confirmed there is no code path capable of launching the exe from the panel: `panel/CSXS/manifest.xml:38-41` does not enable CEP's Node.js integration (no `--enable-nodejs`), and nothing in `panel/js/main.js` or `panel/jsx/capset.jsx` calls ExtendScript's `system.callSystem()` (which *is* available and *could* launch the exe — it's just never used for this).

**What the user actually sees:** install completes, they open AE, everything works (the installer started the service once). They reboot their computer — completely normal, unremarkable user behavior — open AE again, and the panel now says "Service not running. Start the Capset backend," forever, with a retry button that will forever report the same thing, because nothing ever starts it again. Nothing in the message tells them there's a Start Menu shortcut called "Capset Backend" that would fix it. A buyer with zero technical background has no path forward here short of guessing to check the Start Menu (not Task Manager, technically, but still an undocumented manual step the task's bar explicitly rules out). This is arguably the single biggest gap against "simple install ... it works" — the install can be flawless and the plugin will still appear permanently broken after the very next reboot.

### C3. Port 8756 taken → the process exits silently, with no way for the user to tell this apart from "not started yet"

- `backend/app/config.py:11-18` — the TODO here is the developers' own acknowledgment that this is unresolved: *"a fixed port is fragile in the field ... the panel sees a connection refused with no explanation."* I traced it end to end to confirm the TODO is accurate and to characterize exactly what happens:
- `backend/app/main.py:165-171` — `uvicorn.run(host=..., port=config.PORT, ...)`. When the bind fails (`OSError`, address in use), uvicorn's own startup logs the error and calls `sys.exit(1)` — there is no `try/except` anywhere in `capset_service.py` or `main.py` around this call to intercept it.
- `backend/capset-backend.spec:100-105` — `console=False`; `backend/capset_service.py:35-40` routes `sys.stdout`/`sys.stderr` to `os.devnull`.

**What the user actually sees:** the process launches and disappears almost instantly, with **no dialog, no toast, no console flash** — it just isn't running a moment later. The only trace is one log line in `%LOCALAPPDATA%\Capset\logs\backend.log`, a file no ordinary buyer will ever open. The panel shows the exact same "Service not running. Start the Capset backend" message as a completely normal "hasn't been started yet" state — there is no way for the user to distinguish "the backend never ran" from "the backend ran and immediately died because something else is squatting on 8756." Clicking the Start Menu shortcut again just repeats the same silent failure forever. This is realistic, not hypothetical: a crashed or orphaned previous `capset-backend.exe` (e.g. from a prior AE session, or a previous crash that C1's event-loop stall makes more likely to be killed mid-load) is exactly the kind of leftover process that would squat on the port.

---

## IMPORTANT

### I1. `hf_xet` — huggingface_hub's own dependency has grown exactly the same optional/lazy-native-binary shape that broke v0.1.4, one layer deeper

This is a direct answer to "huggingface_hub itself has lazy/optional deps — check them," verified against the actually-installed packages, not guessed:

- `huggingface_hub` 1.29.0 (satisfies the `>=0.30.2` floor in `backend/requirements.txt:20`) declares `hf-xet<2.0.0,>=1.5.2` as a **base** (non-extra) dependency for `platform_machine in {x86_64, amd64, arm64, aarch64}` — i.e. it installs on essentially every Windows/macOS build machine, confirmed via `pip show huggingface_hub` → `Requires: ... hf-xet ...`.
- `hf_xet` is a **separate top-level PyPI package** from `huggingface_hub` (own import name `hf_xet`, own `dist-info`), shipping a compiled Rust extension: `hf_xet/hf_xet.abi3.so` on Linux, the equivalent `.pyd` on Windows.
- It is imported **inside a function**, not at module scope: `huggingface_hub/file_download.py`, function `xet_get()` — `from hf_xet import XetFileInfo  # type: ignore[no-redef]` — guarded by `try/except ImportError`. This is structurally the exact same pattern that made v0.1.4 miss `huggingface_hub` itself (an optional dependency, imported lazily inside a function, invisible to a naive static-import assumption).
- `backend/capset-backend.spec:48-52` loops `collect_all(...)` over `("onnx_asr", "onnxruntime", "huggingface_hub")` — **`hf_xet` is not in that list.**
- The failure mode if it's missing is **not** a crash: `is_xet_available()` (`huggingface_hub/utils/_runtime.py:157-162`) does a safe `importlib.metadata`-based check, and `file_download.py:1978` falls back to plain `http_get()` with only a `logger.warning(...)`, per `HF_HUB_DISABLE_XET`. So *if* it's genuinely absent from the bundle, the most likely outcome is a quieter, slower model download rather than a broken one — this is why I'm not calling it CRITICAL. But:
  - I could not build a real PyInstaller bundle in this environment to confirm whether the bytecode-scan-based hidden-import discovery actually picks up `hf_xet`'s compiled extension and its metadata correctly when it's only reachable via a function-body import three packages deep (`onnx_asr` → `huggingface_hub` → `hf_xet`).
  - `backend/capset_service.py:54-66`'s `--selftest` (the CI gate specifically built to catch this class of bug) checks `onnxruntime`, `onnx_asr`, and `huggingface_hub`'s own `hf_hub_download`/`snapshot_download` — it does **not** attempt `import hf_xet` or otherwise exercise the Xet path, so a broken `hf_xet` bundling would pass CI's `--selftest` silently.
  - `requirements.txt` doesn't mention `hf_xet` at all, so its presence is entirely incidental to whatever `huggingface_hub` happens to pull in on the day the build runs — an unpinned, untracked dependency the team doesn't know it has (see I2 below).

**Recommendation:** either add `hf_xet` explicitly to the `collect_all(...)` loop in the spec (cheap, matches the existing pattern for the other two), or set `HF_HUB_DISABLE_XET=1` before any `onnx_asr`/`huggingface_hub` call to remove the ambiguity entirely and avoid bundling a ~15-25 MB native binary that buys nothing here (this app never needs Xet's chunked-transfer speedup for a one-time model fetch). Either way, extend `OnnxAsrEngine.selftest()` to assert on it explicitly, the same defensive pattern already used for `huggingface_hub`.

### I2. `requirements.txt` pins only floors (`>=`), and the project's own regression test for this doesn't actually enforce a ceiling

- `backend/requirements.txt:5,17,20` — `onnx-asr>=0.11.0`, `onnxruntime>=1.20.0`, `huggingface-hub>=0.30.2`. No upper bounds anywhere.
- `backend/tests/test_requirements.py:76-81` — `test_every_requirement_is_version_pinned` only asserts that some version operator (`>=`, `==`, `~=`, `<=`) is present; a floor-only `>=` satisfies it. The test's name promises more than it checks.
- This isn't theoretical: installing `huggingface-hub>=0.30.2` in this review environment today resolved to **1.29.0** — a materially different dependency graph than the `>=0.30.2` floor the code comments describe (it switched its HTTP client from `requests` to `httpx`, and added `hf_xet` as a base dependency; see I1). The comment at `requirements.txt:7-16` ("EVERY runtime dependency of onnx-asr is an optional EXTRA") is no longer fully accurate for what's actually being installed on a fresh build — it describes `onnx-asr`'s own declared extras, but doesn't account for what `huggingface-hub` itself has since made a hard dependency.
- **Consequence:** a future `pip install -r requirements.txt` on a new build machine (or a CI cache eviction) can silently pick up a newer major version of any of these three packages with a new required binary dependency, and nothing in the test suite or the spec file would catch it until a user hits it. This is exactly the failure category the project has now been burned by twice (onnxruntime, huggingface_hub) — leaving the floor unbounded means it's not actually fixed, just fixed *for the specific version that happened to be installed when it was patched*.

**Recommendation:** pin exact versions (`==`) for the three risk-bearing packages (`onnx-asr`, `onnxruntime`, `huggingface-hub`) and bump deliberately, re-running `--selftest` (extended per I1) each time. This turns "unknown transitive dependency showed up" into "a version bump is a reviewed, single-line diff."

### I3. `--fetch-model` and the "start the service" `[Run]` entries don't use `runasoriginaluser` — the two entries right above them do, for a documented reason that applies here too

- `installer/windows/capset.iss:88-92` — the four `PlayerDebugMode` registry writes all carry `Flags: runhidden runasoriginaluser`, with an extensive comment explaining why: Setup runs elevated, so without it HKCU resolves to the *administrator's* hive, not the actual logged-in user's.
- `installer/windows/capset.iss:97-99` (`--fetch-model`) and `installer/windows/capset.iss:103-105` (start the service) have **no `runasoriginaluser`**.
- The same underlying elevation issue applies to both: whenever Setup is elevated via credentials that differ from the interactively logged-in user — a standard/non-admin user supplying separate admin credentials via UAC's "use a different account" prompt, or a silent enterprise deployment (SCCM/Intune) running as SYSTEM — these two `[Run]` steps execute under *that* identity's user profile, not the real AE user's.
  - The model download (`--fetch-model`) would populate the Hugging Face cache under the **wrong profile** (e.g. an IT admin account's `%USERPROFILE%\.cache\huggingface`, or SYSTEM's). The real user's own account has no cache, so `fetch_model()`'s whole reason for existing — "download it once, visibly, at install time" — is defeated: the actual user still hits the full download on first use, and the bytes downloaded during install are wasted.
  - The auto-started backend process runs under that elevated identity too, and in the SYSTEM/different-admin case is generally not something a later interactive logon will find still running — reinforcing C2 (nothing is running after all).
- `ci.yml`'s installer lint (`.github/workflows/ci.yml:63-79`) checks for `runasoriginaluser` on the registry section specifically, but has no equivalent check for these two `[Run]` entries, so this wouldn't be caught by the existing CI guard.

This won't affect the common single-admin-home-PC case (elevating your own account keeps the same profile), which is likely why it hasn't surfaced yet. It will affect exactly the users named in audit item 8 — non-admin accounts and managed/enterprise images — which is a real slice of "anyone who gets their hands on this plugin."

### I4. Multi-user Windows machines: only the installing account can ever see the panel

- `installer/windows/capset.iss:56-61` installs the CEP extension to `{commoncf32}\Adobe\CEP\extensions\...` — machine-wide, shared by every Windows account.
- The `PlayerDebugMode` keys (`capset.iss:88-92`), which are what let AE load an unsigned extension at all, are written to **HKCU of the installing user only** (that's the whole point of `runasoriginaluser` — it's correctly scoped per-user, which is exactly the problem here).
- **Consequence:** on a shared family PC, or any machine with more than one Windows login used for After Effects, only the person who ran the installer gets a working Capset. Every other account sees the extension folder present but the panel simply never appears in AE's Window > Extensions menu — no error, no explanation, exactly the "it installed but I don't see it" failure mode the `.iss` file's own comment (`capset.iss:76-81`) describes as the thing they were trying to avoid, just recurring for every account except the first.

### I5. CI's release smoke test likely relies on GitHub Actions bandwidth to hide C1, and doesn't prove anything about a cold cache elsewhere

- `.github/workflows/release.yml:72-103` starts the freshly built exe with **no prior `--fetch-model` step** and polls `/health` for up to ~70 s (`curl --max-time 3`, 30 iterations, 2 s sleep) before declaring the bundle broken.
- Per C1, `transcriber.load()` on a cold cache means the full ~600 MB Hugging Face download must complete inside that ~70 s window purely to make `/health` answer at all — this only works because GitHub-hosted Windows runners typically have very fast, low-latency links to common CDNs. It is not evidence the same thing completes acceptably on a residential connection, and if Hugging Face's CDN has a slow day, this CI step becomes flaky for reasons that have nothing to do with the actual bundle correctness it's meant to test.
- Worth noting explicitly since it means the CI gate that's supposed to catch "the bundle is broken" (per its own comment, written specifically in response to the v0.1.3 incident) is silently dependent on a timing assumption the team probably isn't aware they're relying on.

### I6. Uninstall doesn't remove the ~600 MB model cache or the log directory

- `installer/windows/capset.iss:122-123` (`[UninstallDelete]`) only removes the CEP extension folder.
- The Hugging Face model cache (default location, since `MODEL_DIR`/`HF_HOME` are never set anywhere in this codebase — `backend/app/config.py:45`) lives under the user's profile (`%USERPROFILE%\.cache\huggingface`), entirely outside `{app}`, and is never tracked or cleaned up.
- `backend/app/logging_setup.py:28-30` writes logs to `%LOCALAPPDATA%\Capset\logs`, also outside `{app}` and never cleaned up.
- This does **not** break a reinstall — quite the opposite, `fetch_model()`'s cache-check-first design (`backend/app/engines/onnx_asr_engine.py:113-119`) means a reinstall benefits from the leftover cache and skips the download. But "Uninstall Capset" leaving ~600 MB on disk with zero mention anywhere the user would see is worth calling out as a real gap against user expectations, distinct from "breaks a reinstall."

---

## MINOR

- **`[Languages]` only declares `"english"`** (`capset.iss:46-47`). Not a functional failure — Inno Setup will render the wizard in English regardless of the OS locale rather than erroring — just unlocalized on a non-English Windows install. Low cost to note, low cost to fix later.
- **`PrivilegesRequired=admin`** (`capset.iss:37`) means the installer cannot run at all for a user with no admin credentials available to them whatsoever (locked-down corporate images, a non-admin family member's account, some school/kiosk machines). This is close to unavoidable given the current design (writing to Common Files for the CEP extension, Program Files for the backend, both require elevation) — Adobe CEP does support a per-user extensions path (`%APPDATA%\Adobe\CEP\extensions`) as an alternative that wouldn't need elevation for the panel half, not used here. Flagging as a known architectural constraint worth a deliberate decision, not a packaging bug to patch.
- **`test_every_requirement_is_version_pinned` (`test_requirements.py:76`) is misleadingly named** relative to what it enforces (see I2) — a naming/intent mismatch worth fixing even independent of tightening the actual pins.
- **The update checker (`panel/js/lib/updates.js`) only ever links out to a Gumroad page**, by design (documented at the top of the file) — no in-place update, no download-and-relaunch-installer flow. Reasonable given Capset is sold per-buyer, but worth being explicit that it means *every* finding in this report recurs on *every* future version bump, since each new version is a fresh full manual install through the same path.

---

## NOT AN ISSUE (verified, not just assumed)

- **No remaining `__file__`-into-frozen-temp-dir bug.** Full-repo grep for `__file__` across `backend/` and `installer/` turns up only: `backend/capset_service.py:47` (used solely to prepend the script's own directory to `sys.path`, explicitly documented as a harmless no-op when frozen since PyInstaller has already placed the package), and non-runtime files (`bench.py`, `build_payload.py`, test files). No code resolves a bundled model/asset/ffmpeg-style path via `__file__`. The two previous instances of this bug class appear genuinely fixed and no new one has crept in.
- **`onnx_asr`'s own bundled ONNX preprocessor/resampler data** (`onnx_asr/preprocessors/data/*.onnx`, `fbanks.npz` — accessed via `importlib.resources.files(...)`, referenced in `backend/app/audio.py`'s docstring) is exactly the kind of package data `collect_all("onnx_asr")` (`capset-backend.spec:48-52`) is designed to sweep up via its built-in data-file collection. Verified structurally against the real installed package; this is correctly handled, and is the intended reason `collect_all` was chosen over `collect_dynamic_libs` alone.
- **Silero VAD's lazy import is intentional and safe.** `backend/app/vad.py:64-65` imports `silero_vad` inside a function, wrapped in a broad `try/except` that falls back to an energy gate (`_energy_spans`) and ultimately to whole-file chunking. It's deliberately excluded from `requirements.txt` (to avoid pulling PyTorch), and `backend/tests/test_requirements.py` enforces that exclusion. This is the *correct* way to do an optional/lazy import — contrast with I1.
- **Network-down at model-load time degrades reasonably, and is bounded in time** — for a connection that actively fails fast (refused/unreachable). Traced through `huggingface_hub`'s actual retry logic (`utils/_http.py`): `DEFAULT_REQUEST_TIMEOUT = 10`, `max_retries=5`, backoff capped at 8 s — roughly 1-2 minutes worst case before it gives up. The resulting `LocalEntryNotFoundError` (confirmed to be a `FileNotFoundError` subclass) is exactly what `onnx_asr/resolver.py`'s fallback path lets propagate, caught broadly by `OnnxAsrEngine.load()`'s `except Exception`, surfaced as `EngineUnavailable`, and reported through `/health`'s `status: "degraded"` with a real message (`backend/app/main.py:51-55, 85-87`). This is genuinely well-designed — **but it only helps once `lifespan.startup()` returns**, and per C1 it cannot return while blocked, so this good design is currently unreachable for the slow-connection case, only the fast-refusal case.
- **`sys.stdout = None` (the v0.1.5 bug) is genuinely fixed.** `capset_service.py:23-43`'s `_ensure_standard_streams()` runs at module scope before `uvicorn` is ever imported (confirmed: `main.py:158` imports `uvicorn` lazily inside `main()`, specifically for this reason), and `logging_setup.py:46`'s own `StreamHandler` guard is keyed off `getattr(sys, "frozen", False)`, not stream identity, so it correctly stays out of the way in a frozen build regardless of stream state. Backed by dedicated tests (`test_headless.py`) that exercise the exact original failure (`uvicorn.logging.DefaultFormatter` under `sys.stdout=None`). Solid.
- **Locked-files-on-upgrade (v0.1.8) is genuinely fixed.** `capset.iss:142-171` — both `PrepareToInstall()` (upgrade path) and `InitializeUninstall()` call `StopBackend()`, which `taskkill /IM capset-backend.exe /F /T`s the process and sleeps 1s for handle release before Setup touches any files. `.github/workflows/ci.yml:83-99` explicitly lints for the presence of this exact protection (`PrepareToInstall`, `taskkill`, `InitializeUninstall`), so a regression here would be caught before release.
- **No console/TTY/stdin/writable-CWD assumptions elsewhere.** Full grep across `backend/app/` for `getcwd`, `chdir`, `input(`, `sys.stdin`, and relative-path opens returns nothing. Temp files go through `tempfile.mkstemp()` (`backend/app/main.py:116`, OS temp dir, not CWD). Logs deliberately go to `%LOCALAPPDATA%\Capset\logs` rather than next to the executable, specifically because Program Files isn't writable without elevation — documented and correct reasoning in `logging_setup.py`'s own docstring.
- **Import-completeness for the three historically-broken packages is now actively CI-gated.** `capset_service.py:54-66`'s `--selftest`, driven by `release.yml:60-70`, imports the exact symbols each of onnxruntime/onnx_asr/huggingface_hub needs and fails the build if any is missing. This is a strong, well-targeted regression guard for the three *known* failure classes — it just doesn't yet extend to the newer one identified in I1.

---

## Summary for prioritization

If only three things get fixed before the next release, make it C1 (event loop stall — turns every first run into an apparent freeze), C2 (no restart-after-reboot — turns every second AE session after any reboot into an apparent permanent break), and C3 (silent death on port conflict — turns an already-published, self-acknowledged TODO into a concrete, traceable "the app just silently stops working" report from a real buyer, no less real for being predicted).
