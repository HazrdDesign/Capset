# Cutting a release

## Where we are

| | |
|---|---|
| **Shipped** | **v0.5.0** — tag `v0.5.0` on `e3f6d67` |
| **Next** | **v0.6.0** — notes written, at `docs/RELEASE-NOTES-v0.6.0.md` |

Keep this table current: update it in the same commit that adds the next
version's notes, so the number is answerable from the repository rather than
from memory or a chat log. The rule for choosing it is ordinary semver — a
new feature or a change to how something behaves is a minor bump, a fix on
its own is a patch.

To ship the version named above: merge to `main`, then

```bash
git fetch origin main
git tag -a v0.6.0 <merge commit> -m "Capset v0.6.0"
git push origin v0.6.0
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

In CI since v0.6.0: a `macos-14` job builds `Capset-<version>.pkg` and the
publish step attaches it to the same release as the Windows `.exe`. Two things
to know about it.

**It is Apple Silicon only,** and that is not a shortcut. onnxruntime ships
macOS wheels for `arm64` alone — no `x86_64` and no `universal2` — so an Intel
build would need a different ASR runtime, not a build flag. The package
declares `hostArchitectures="arm64"`, so an Intel Mac is refused by the
installer rather than failing later at launch.

**It is unsigned and un-notarized.** The binaries are ad-hoc signed, which is
mandatory rather than optional — Apple Silicon SIGKILLs an unsigned arm64
binary — but that is not notarization. A tester has to go to System Settings →
Privacy & Security → Open Anyway on first run. Removing that prompt needs a
paid Apple Developer account ($99/yr); when there is one, set
`DEVELOPER_ID_INSTALLER` and `NOTARY_PROFILE` as repository secrets and pass
them into the macOS job — `build-pkg.sh` already reads both.

**Runner minutes:** GitHub bills macOS runners at 10x the rate of Linux ones
on private repositories (Windows is 2x). This job downloads the ~600 MB model
and builds a ~500 MB package, so it is the expensive part of a release: figure
150-250 billed minutes against an allowance of 2,000/month on a Free plan,
3,000 on Pro. With no payment method on file the consequence of exhausting it
is that Actions stops running until the next cycle, not a bill.

**Artifact storage** is the tighter limit, and the reason both upload steps set
`retention-days: 3`. Each installer is ~500 MB and the included Actions
storage on a private repo is 500 MB (Free) or 1 GB (Pro), so the default
90-day retention would park a full allowance of dead weight per release. The
artifacts only exist to hand the installers to the `release` job a minute
later; afterwards they live on the release page, which is storage that is not
billed this way. Usage is at github.com/settings/billing.

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
