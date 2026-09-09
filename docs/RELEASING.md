# Cutting a release

## Where we are

| | |
|---|---|
| **Shipped** | **v0.4.0** — tag `v0.4.0` on `c224846` |
| **Next** | **v0.5.0** — notes written, at `docs/RELEASE-NOTES-v0.5.0.md` |

Keep this table current: update it in the same commit that adds the next
version's notes, so the number is answerable from the repository rather than
from memory or a chat log. The rule for choosing it is ordinary semver — a
new feature or a change to how something behaves is a minor bump, a fix on
its own is a patch.

To ship the version named above: merge to `main`, then

```bash
git fetch origin main
git tag -a v0.5.0 <merge commit> -m "Capset v0.5.0"
git push origin v0.5.0
```

The Windows installer is built by `.github/workflows/release.yml` on a
`windows-latest` runner. That is not a convenience — **PyInstaller is not a
cross-compiler**, so a Windows `.exe` can only be produced on Windows, and
Inno Setup is Windows-only.

## Two ways to trigger it

**Push a tag** (preferred — the tag is the release record):

```bash
git tag -a v0.1 -m "Capset v0.1"
git push origin v0.1
```

**Or dispatch it manually:** repository → **Actions** → **Release** → *Run
workflow* → set version to `0.1`.

Either way the workflow will:

1. Build the backend with PyInstaller (Windows).
2. Stage the payload (`installer/build_payload.py`).
3. Install Inno Setup via chocolatey — it is **not** preinstalled on the
   runner.
4. Compile `Capset-Setup-<version>.exe`.
5. Verify the exe and installer exist, failing loudly rather than publishing
   an empty release.
6. Publish the release with `docs/RELEASE-NOTES-v0.1.md` as the body.

## macOS

Not in CI yet. It needs a `macos-latest` runner and, for a warning-free
install, Apple signing certificates as repository secrets. Build locally
meanwhile:

```bash
cd backend && pyinstaller capset-backend.spec --noconfirm && cd ..
./installer/macos/build-pkg.sh 0.1
```

## Version numbering

The tag drives everything: `v0.1` → version `0.1` → `Capset-Setup-0.1.exe`
and a release named "Capset v0.1". The workflow strips the leading `v`.

## Release notes

Write `docs/RELEASE-NOTES-v<version>.md` before tagging — `v0.4.0` looks for
`docs/RELEASE-NOTES-v0.4.0.md`, then `docs/RELEASE-NOTES-v0.4.md` for a file
covering the whole minor series (which is how `RELEASE-NOTES-v0.1.md` served
every `v0.1.x` tag).

If neither exists the workflow publishes a stub linking to the commit log and
warns in the job summary. It does not fail: the installer at that point is a
good build twenty minutes in the making, and losing it over a missing markdown
file helps nobody. It also does not fall back to another version's notes —
which it did for eleven tags, publishing v0.1's text under every release from
v0.1.2 to v0.3.2, because `body_path` was hardcoded to that one file.
