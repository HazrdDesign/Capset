# installer/ — packaging

One installer per OS, each bundling the CEP extension and the backend
service. This mirrors what Captioneer ships (`.exe` + `.pkg`, same build
date) — see `docs/research/05-captioneer-teardown.md`.

```
build_payload.py     Stages build/payload/ — shared by both platforms.
windows/capset.iss   Inno Setup script.
macos/build-pkg.sh   pkgbuild/productbuild + signing + notarisation.
```

## Why there is no single cross-platform installer

An `.exe` is a Windows PE binary and cannot run on macOS; a `.pkg` needs
Mach-O binaries. More fundamentally, **PyInstaller is not a cross-compiler** —
a Windows backend binary can only be produced on Windows, and a macOS one only
on macOS. Two build pipelines is not a preference; it is the constraint.

From the buyer's side it is still one product with two downloads attached.

## Payload layout

```
build/payload/
  panel/     -> <CEP extensions>/design.hazrd.capset/
  backend/   -> <app>/backend/
  vendor/    -> <app>/vendor/     (ffmpeg, optional)
```

`build_payload.py` runs anywhere and validates as it goes: it refuses to stage
a payload missing `CSXS/manifest.xml` or any other required file, and fails if
development files (`tests/`, `package.json`, `node_modules/`) leak in. Without
a manifest the extension installs silently and never appears in After Effects,
which is a miserable bug to diagnose from a user report.

## Windows

Built by `.github/workflows/release.yml` on a `windows-latest` runner. To
build locally on Windows:

```powershell
pip install -r backend/requirements.txt pyinstaller
cd backend; pyinstaller capset-backend.spec --noconfirm; cd ..
python installer/build_payload.py --backend-dist backend/dist/capset-backend
choco install innosetup -y
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DAppVersion=0.1.0 `
    "/DPayloadDir=$PWD\build\payload" installer\windows\capset.iss
```

Output: `dist/Capset-Setup-<version>.exe`.

Notes:
- Inno Setup is **not** preinstalled on GitHub's Windows runners.
- The extension goes to `{commoncf32}\Adobe\CEP\extensions\`, which is
  `C:\Program Files (x86)\Common Files\...` — hence `PrivilegesRequired=admin`.
- `PlayerDebugMode` is set for CSXS 9–12 because this build is unsigned; CEP
  will not load an unsigned extension otherwise.

## macOS

```bash
cd backend && pyinstaller capset-backend.spec --noconfirm && cd ..
./installer/macos/build-pkg.sh 0.1.0
```

Signing is opt-in:

```bash
export DEVELOPER_ID_INSTALLER="Developer ID Installer: Name (TEAMID)"
export NOTARY_PROFILE="capset"   # xcrun notarytool store-credentials
./installer/macos/build-pkg.sh 0.1.0
```

Two distinct things, easily conflated:

- **Ad-hoc signing** (`codesign -s -`) is always applied and is **mandatory** —
  Apple Silicon refuses to execute unsigned arm64 binaries at all (SIGKILL, not
  a warning). Free, no Apple account.
- **Developer ID + notarisation** removes the Gatekeeper prompt. Needs a paid
  account ($99/yr, recurring), and `.pkg` signing uses the *Developer ID
  Installer* certificate — not *Developer ID Application*.

## Code signing on Windows

Unsigned installers trigger SmartScreen. When signing, buy an **OV**
certificate, not EV: Microsoft removed EV's instant-SmartScreen bypass in
2024, so EV now builds reputation exactly like OV at several times the price.
See `docs/research/07-distribution-licensing.md`.

Inno Setup can sign as part of the build via the `SignTool=` directive.
