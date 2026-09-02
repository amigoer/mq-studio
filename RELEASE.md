# Releasing

Cutting a release is: bump the version everywhere, write both changelogs, push a
tag, then check the draft before publishing it.

## 1. Bump the version

`package.json` is the single source of truth. `npm run check:version` verifies
every mirror of it and names any that drift, so the loop is: edit, run it, fix
what it names.

Hand-edited mirrors:

- `package.json`, `package-lock.json` (two places: top level and `packages[""]`)
- `frontend/package.json`, `frontend/package-lock.json` (same two places)
- `build/config.yml` → `info.version`

Generated mirrors — set `info.version` in `build/config.yml`, then run
`wails3 task common:update:build-assets` and commit what it rewrites:

- `build/darwin/Info.plist`, `build/darwin/Info.dev.plist`
- `build/windows/info.json`, `build/windows/nsis/wails_tools.nsh`,
  `build/windows/wails.exe.manifest`
- `build/linux/nfpm/nfpm.yaml`

> `update:build-assets` merges the template over your file, so hand-added keys
> the template does not emit (like `NSLocalNetworkUsageDescription`) survive,
> but keys it does emit are overwritten. `LSMinimumSystemVersion` is one of
> those — the template pins it to 12.0.0, which is why the build flags in
> `build/darwin/Taskfile.yml` target 12.0 as well.

> Three files it rewrites wholesale rather than merging, and they are entirely
> hand-authored: `build/linux/desktop` (loses the categories, the keywords and
> the Chinese comment), `build/linux/nfpm/nfpm.yaml` (loses the maintainer,
> homepage and licence), and `build/darwin/entitlements.plist`, which it
> deletes. Check `git status build/` after running it, restore those three, and
> set the nfpm version by hand.

## 2. Write the changelogs

Add a `## [<version>] - <date>` section to **both** `CHANGELOG.md` and
`CHANGELOG.zh-CN.md`, below the `Unreleased` heading, which stays and is left
empty. The brackets are Keep a Changelog's spelling and nothing defines them
as links, so there is nothing to update at the bottom of either file.

The release notes are generated from these two files. A tag whose version has
no changelog section fails the release rather than publishing empty notes, and
`node scripts/release-notes.mjs <version>` prints what the release will carry.

## 3. Check locally

```bash
npm run check
```

Building the real macOS image is worth doing before tagging:

```bash
wails3 task darwin:package:dmg
```

(needs `pipx install dmgbuild`)

## 4. Tag and push

```bash
git tag v<version>
git push origin v<version>
```

Pushing the tag starts the release workflow. It refuses to run if the tag does
not match `package.json`, and re-checks that the tag has not moved between
resolving the commit and publishing.

To re-run a release without moving the tag, use the workflow's manual
`workflow_dispatch` entry and pass the same tag.

## 5. Check the draft, then publish

The workflow creates a **draft** release. Nothing reaches users until you press
Publish — in particular the in-app update check only ever sees published
releases.

Before publishing:

- 11 files are attached: 2 `.dmg`, 2 `.exe`, 2 `.AppImage`, 2 `.deb`, 2 `.rpm`,
  and `SHA256SUMS.txt`
- the notes carry both language sections
- install at least the macOS image by hand, on a machine that has not built it,
  downloading through a browser so the quarantine flag is really applied

## What the in-app updater needs from a release

The app updates itself from these artifacts, so the release is a contract, not
just a set of downloads. `internal/update` computes the file it needs rather
than being told, and refuses anything it cannot verify.

- **The names must stay `mq-studio-<version>-<os>-<arch>.<ext>`.** This is
  `PACKAGE_BASE` in `package.yml`, and `update.Target.PackageName` rebuilds it
  from the running platform. `TestPackageNameMatchesTheReleaseWorkflow` pins
  the two together; changing the scheme in the workflow without changing it
  there leaves every installed copy looking for a file that is not attached.
- **`SHA256SUMS.txt` must be attached.** A package whose name is absent from
  it is refused rather than installed unverified, and so is a release that
  publishes no list at all. The panel then offers the releases page instead.
- **Draft and pre-release tags are invisible to it**, which is what makes the
  draft step above safe: nothing reaches an installed copy until you publish.

Releases before v0.1.4 predate both rules -- v0.1.3 ships `rocket-leaf-*` names
and no checksum file -- which costs nothing, since an update is only ever
fetched *forward*.

## Signing

Nothing is code-signed yet. Both platforms are wired for it and skip when the
secrets are absent, so configuring the secrets is the only step left.

macOS (repository environment `release`):

| Secret | Value |
| --- | --- |
| `MACOS_SIGN_IDENTITY` | `Developer ID Application: NAME (TEAMID)` |
| `MACOS_CSC_LINK` | the `.p12`, base64 encoded |
| `MACOS_CSC_KEY_PASSWORD` | its export password |
| `APPLE_ID` | Apple ID used for notarisation |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | ten-character team ID |

Windows: `WINDOWS_CERTIFICATE` (base64 `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD`.

Once macOS signing is on, the disk image drops the First Run helper and switches
to the shorter window layout on its own, and the "not signed" banner disappears
from the release notes. Nothing needs deleting by hand.

> The packaging workflow is shared with CI, and a job's `environment:` cannot be
> set conditionally — so the `release` environment is attached to CI's packaging
> runs too. Keep it unprotected: **required reviewers** would make every push to
> `main` wait for an approval, and **deployment branch rules** limited to tags
> would fail those runs outright. If you want the protections, split them out by
> giving the workflow an `environment` input and passing a separate name from
> `ci.yml`.

**The one thing the CI matrix cannot cover:** it always builds unsigned, so the
hardened runtime is never exercised there. The first signed build must be run
manually and launched, because entitlement problems only ever show up in a
signed build.
