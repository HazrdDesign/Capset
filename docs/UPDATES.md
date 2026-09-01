# Update checking

The panel can check for a newer version and show a banner. It **notifies**;
it does not install.

## Why it does not auto-install

Capset is sold, so the installer is not at a public URL — Gumroad issues
per-buyer download links. There is no public file for the panel to fetch, so
the manifest can only point at the buyer's library page.

Silent installation would also need elevation: the extension lives under
`Program Files (x86)\Common Files`, so replacing it triggers UAC no matter
who initiates it. A "silent" updater that pops a UAC prompt is worse than an
honest button.

A future version could download the installer to temp and launch it — one UAC
prompt, no browser trip — but that needs a download host that can
authenticate buyers.

## Setting it up

1. Host a small JSON file at a public URL:

```json
{
  "version": "0.2.0",
  "url": "https://hazrd.gumroad.com/l/capset",
  "notes": "Adds karaoke highlighting and fixes caption drift.",
  "minimum": "0.1.0"
}
```

2. Point the panel at it in `capset.config.json`:

```json
{ "updateManifestUrl": "https://hazrd.design/capset/latest.json" }
```

Leave it `null` and update checking is off — no network calls at all.

## Fields

| Field | Meaning |
|---|---|
| `version` | Latest available. Compared numerically against the installed version. |
| `url` | Where to send the user. Their Gumroad library, usually. |
| `notes` | One line shown in the banner. |
| `minimum` | Optional. Below this, the banner says the update is **required** — for a change that breaks compatibility with older panels. |

## Behaviour

- Checks at most **once a day**, remembered in `localStorage`.
- Being offline is silent. A failed check is never shown as an error, and
  does **not** start the once-a-day clock — otherwise one offline moment
  would suppress checks for the rest of the day.
- Version comparison is numeric per segment, so `0.1.10` is correctly newer
  than `0.1.9`. Pre-releases (`1.0.0-beta`) sort before their release.

## Hosting the manifest

Anywhere public and static: GitHub Pages, an S3/R2 bucket, or a file on
hazrd.design. It must be reachable without authentication, which is why the
private repo's Releases API is not an option.
