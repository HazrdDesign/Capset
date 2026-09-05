#!/usr/bin/env python3
"""Stage the installer payload.

Collects the CEP extension and the built backend into one tree that the
platform installers (Inno Setup on Windows, pkgbuild on macOS) consume, so
both platforms package an identical layout.

    build/payload/
      panel/     -> <CEP extensions>/design.hazrd.capset/
      backend/   -> <app>/backend/
    
Runs on any OS: staging is just file copying, and doing it here rather than in
each installer script keeps the two in step.

    python installer/build_payload.py --backend-dist backend/dist/capset-backend
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Development-only files that must never reach a user's machine. "tools" is
# the animation tuning bench: useful while building the library, not something
# a customer needs installed into their Adobe CEP folder.
PANEL_EXCLUDE = {"node_modules", "tests", "tools",
                 "package.json", "package-lock.json", ".DS_Store"}


def clean(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def stamp_manifest(manifest: Path, version: str) -> None:
    """Write the release version into the CEP manifest.

    The panel reads its own version from here (currentVersion() in
    js/main.js) and compares it against the update manifest. Leaving it at
    whatever is committed means every install reports the committed version
    forever, so the moment a newer release exists the update banner appears
    and never goes away — including immediately after the user installs that
    very release.

    Also what After Effects shows in Window > Extensions, and what decides
    whether an upgrade replaces the extension or sits alongside it.
    """
    if not VERSION_RE.match(version):
        raise SystemExit(
            f"--version must be MAJOR.MINOR.PATCH for the CEP manifest, got {version!r}"
        )
    text = manifest.read_text(encoding="utf-8")
    stamped, bundle_count = re.subn(
        r'(ExtensionBundleVersion=")[^"]*(")', rf"\g<1>{version}\g<2>", text
    )
    stamped, ext_count = re.subn(
        r'(<Extension Id="[^"]*" Version=")[^"]*(")', rf"\g<1>{version}\g<2>", stamped
    )
    if not bundle_count or not ext_count:
        raise SystemExit(
            "could not stamp the version into CSXS/manifest.xml — its "
            "ExtensionBundleVersion or Extension Version attribute has moved"
        )
    manifest.write_text(stamped, encoding="utf-8")


# Files the panel cannot run without, named one by one because each is
# individually load-bearing and a typo in one of these names should fail the
# build rather than silently ship a broken extension.
#
# The js/lib/ modules are NOT listed here — see _library_files().
REQUIRED_PANEL_FILES = (
    "index.html", "css/panel.css",
    "jsx/capset.jsx", "jsx/json2.jsx",
    "js/vendor/CSInterface.js", "js/main.js",
    "capset.config.json",
    "animations/animations.json",
)


def _library_files(source: Path) -> list[str]:
    """Every module in panel/js/lib/, read from the source tree.

    Derived rather than typed. This list used to be spelled out by hand and
    drifted four files behind: cepfile.js, launcher.js, presets.js and
    preview.js were all missing from it, cepfile.js being the one that reads
    the rendered audio. copytree copies the whole directory regardless, so
    nothing shipped broken — but a check that has silently stopped covering
    the thing it was written for is worse than no check, because it still
    reads like protection.

    index.html loads all of these (panel/tests/wiring.test.js enforces that),
    so a missing one is a panel that throws on load and shows nothing.
    """
    lib = source / "js" / "lib"
    names = sorted(p.name for p in lib.glob("*.js"))
    if not names:
        # An empty result would make the check below vacuously pass, which is
        # exactly the failure mode being fixed here.
        raise SystemExit(f"no panel libraries found in {lib} — is the source tree intact?")
    return [f"js/lib/{name}" for name in names]


def copy_panel(dest: Path, version: str) -> list[str]:
    source = ROOT / "panel"
    if not source.is_dir():
        raise SystemExit("panel/ not found")

    def ignore(directory, names):
        return [n for n in names if n in PANEL_EXCLUDE]

    shutil.copytree(source, dest, ignore=ignore, dirs_exist_ok=True)

    # A manifest is what makes the folder an extension; without it the panel
    # installs silently and never appears in After Effects.
    manifest = dest / "CSXS" / "manifest.xml"
    if not manifest.is_file():
        raise SystemExit("payload is missing CSXS/manifest.xml")
    stamp_manifest(manifest, version)

    required = list(REQUIRED_PANEL_FILES) + _library_files(source)
    missing = [rel for rel in required if not (dest / rel).is_file()]
    if missing:
        raise SystemExit(f"payload is missing required files: {missing}")

    leaked = [n for n in PANEL_EXCLUDE if (dest / n).exists()]
    if leaked:
        raise SystemExit(f"development files leaked into payload: {leaked}")

    return sorted(p.name for p in dest.iterdir())


def copy_backend(dest: Path, dist: Path | None) -> str:
    if dist is None or not dist.is_dir():
        # Staging must still succeed so the layout can be validated on a
        # machine that cannot run PyInstaller (it is not a cross-compiler).
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "PLACEHOLDER.txt").write_text(
            "The built backend was not supplied to build_payload.py.\n"
            "Run PyInstaller on the target OS and pass --backend-dist.\n",
            encoding="utf-8",
        )
        return "placeholder"

    shutil.copytree(dist, dest, dirs_exist_ok=True)
    return "built"


def copy_model(dest: Path, source: Path | None) -> str:
    """Stage the speech model the installer lays down beside the backend.

    Bundling it is what makes a shipped Capset independent of Hugging Face:
    no download at install, none on first use, and no dependence on a
    third-party account staying public under the same repository name.

    Staging is allowed to proceed without it so the layout can be validated
    on a machine that has not downloaded 600 MB, but the result is reported
    honestly and main() refuses to call that a complete payload.
    """
    if source is None or not source.is_dir():
        return "absent"

    files = [p for p in source.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    if total < 100e6:
        raise SystemExit(
            f"model directory {source} holds only {total / 1e6:.0f} MB, which "
            "is far too small for the speech model. Staging it would produce "
            "an installer that looks complete and cannot transcribe."
        )

    shutil.copytree(source, dest, dirs_exist_ok=True)
    return f"bundled ({total / 1_048_576:.0f} MiB)"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ROOT / "build" / "payload"))
    parser.add_argument("--backend-dist", default=None,
                        help="PyInstaller onedir output (backend/dist/capset-backend)")
    parser.add_argument("--model-dir", default=None,
                        help="Speech model staged by capset-backend --stage-model")
    parser.add_argument("--version", default="0.1.0")
    args = parser.parse_args()

    out = Path(args.out).resolve()
    clean(out)

    panel_entries = copy_panel(out / "panel", args.version)
    backend_state = copy_backend(
        out / "backend",
        Path(args.backend_dist).resolve() if args.backend_dist else None,
    )
    model_state = copy_model(
        out / "model",
        Path(args.model_dir).resolve() if args.model_dir else None,
    )

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    (out / "payload.json").write_text(
        json.dumps(
            {
                "version": args.version,
                "backend": backend_state,
                "model": model_state,
                "bytes": total,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"payload staged at {out}")
    print(f"  panel   : {', '.join(panel_entries)}")
    print(f"  backend : {backend_state}")
    print(f"  model   : {model_state}")
    print(f"  size    : {total / 1_048_576:.1f} MiB")
    if model_state == "absent":
        print("\nNOTE: no speech model staged. The installer built from this "
              "payload will fall back to downloading it on first use, which is "
              "the dependency bundling exists to remove. Pass --model-dir.",
              file=sys.stderr)
    if backend_state == "placeholder":
        print("\nNOTE: no backend binary staged. The installer built from this "
              "payload will NOT work — PyInstaller must run on the target OS.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
