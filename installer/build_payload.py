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

# Development-only files that must never reach a user's machine.
PANEL_EXCLUDE = {"node_modules", "tests", "package.json", "package-lock.json", ".DS_Store"}


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

    missing = [
        rel for rel in (
            "index.html", "css/panel.css",
            "jsx/capset.jsx", "jsx/json2.jsx",
            "js/vendor/CSInterface.js", "js/main.js",
            "js/lib/timing.js", "js/lib/segmentation.js",
            "js/lib/srt.js", "js/lib/backend.js", "js/lib/updates.js",
            "capset.config.json",
            "animations/animations.json",
        )
        if not (dest / rel).is_file()
    ]
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ROOT / "build" / "payload"))
    parser.add_argument("--backend-dist", default=None,
                        help="PyInstaller onedir output (backend/dist/capset-backend)")
    parser.add_argument("--version", default="0.1.0")
    args = parser.parse_args()

    out = Path(args.out).resolve()
    clean(out)

    panel_entries = copy_panel(out / "panel", args.version)
    backend_state = copy_backend(
        out / "backend",
        Path(args.backend_dist).resolve() if args.backend_dist else None,
    )

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    (out / "payload.json").write_text(
        json.dumps(
            {
                "version": args.version,
                "backend": backend_state,
                "bytes": total,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"payload staged at {out}")
    print(f"  panel   : {', '.join(panel_entries)}")
    print(f"  backend : {backend_state}")
    print(f"  size    : {total / 1_048_576:.1f} MiB")
    if backend_state == "placeholder":
        print("\nNOTE: no backend binary staged. The installer built from this "
              "payload will NOT work — PyInstaller must run on the target OS.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
