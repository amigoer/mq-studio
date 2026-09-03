# In-app updates

The app reads a small manifest that says what the latest release is, downloads
the package for the platform it is running on, verifies it against the digest
the manifest published, replaces the installation and comes back. How much of
that it does without being asked is a setting.

The manifest is served by several mirrors, and which one answers is measured on
the user's own machine - see [Mirrors](#mirrors-and-how-one-is-chosen).

This describes what is implemented. The release-side contract it depends on is
in [RELEASE.md](../RELEASE.md#what-the-in-app-updater-needs-from-a-release).

## The policy ladder

`updatePolicy` in the application settings, one of four rungs. It replaced the
`autoCheckUpdate` boolean, which said only "look or don't"; stored settings
migrate on load, and a check that was switched off stays off.

| Value | Settings label | Behaviour |
| --- | --- | --- |
| `off` | 关闭 | Never checks. The button still does. |
| `notify` | 仅提醒 | Checks and reports. Downloading is the user's call. |
| `download` | 自动下载，手动安装 | Fetches and verifies in the background, then waits to be told to install. |
| `auto` | 自动更新（退出时安装） | Also installs — at quit, so an update never interrupts a session that did not ask for one. |

`auto` deliberately does not swap the application out from under a running
session. The package is applied from the shutdown hook, and the next launch is
the new version; "立即重启更新" is offered as well for anyone who does not want
to wait.

## When it looks

Five seconds after launch, and every 24 hours after that. The startup check is
skipped when the last one was less than 24 hours ago, so relaunching repeatedly
does not re-query the mirrors — the timestamp survives restarts, and a check that
failed still counts, so being offline does not turn the interval into a retry
loop.

The schedule lives in Go, not in the renderer. Closing to the tray leaves the
process running for days with no window to hold a timer, and the policy it
reads is a Go setting to begin with. The renderer only draws what the manager
publishes on the `update:state` event.

The only thing the renderer decides is when to speak: a release is announced
once per launch, by a toast that stays until it is answered. That memory is the
session's, not Go's — a release the user closed without acting on comes back
the next time the app starts, and skipping it is what stops it for good.
Pressing the button is different — that reports every outcome, including
"already on the latest", and a check that finds a release opens the dialog
rather than raising a toast about it.

## Mirrors, and how one is chosen

A release lives on more than one host. `scripts/mirrors.json` is the list, and
the app compiles in its own copy of it (`BootstrapMirrors`), so the two are
pinned together by a test.

Which one a given user should use is not knowable in advance. A host reachable
from one network is blocked on the next, and neither GeoDNS nor a server-side
redirect can see that - a server that routes traffic is itself something that
can be unreachable. So the app measures it, on the user's own machine.

**The manifest is the probe.** It is a few KB, every mirror has to serve it, and
a check has to fetch it anyway. Racing mirrors for it therefore costs nothing
and answers exactly the question that matters, and whichever wins is handed the
package download that follows.

The mirrors do not start together. Each one begins 400 ms after the one before
it, so a working first choice means no other request is ever made — having
several mirrors costs nothing until one of them is actually needed. The first
readable manifest wins and the rest are cancelled.

The winner is remembered. The next check goes straight to it, alone, with a two
second budget: a routine check is one request and no race at all. If it does not
answer, the cost of having been wrong is that one request and the full race
follows. The preference is re-measured after seven days regardless, which both
releases a mirror that has since gone bad and gives one added later a turn.

A manifest can also name mirrors, and those are merged into the list and kept.
That is what lets a mirror added to a future release reach a build that shipped
before it existed - which matters most for exactly the users who need it, since
a user who cannot reach any mirror cannot update to a build that knows about a
new one. The merge only ever adds: an entry from a manifest can neither remove a
compiled-in mirror nor redefine one, so the shipped path stays reachable
whatever a mirror says.

If a mirror stops answering partway through the package download, the next one
is tried. That is safe only because the digest travels in the manifest rather
than in a file fetched alongside the package - otherwise whoever served the
bytes would also be attesting to them.

## Where the update is offered

The dialog, `frontend/src/design/shell/UpdateDialog.tsx`, is the surface that
takes the update: what changed, the download and its progress, and the restart.
It opens from the title bar icon and from the toast, so nothing about updating
requires a trip into the settings page — the settings card is still there, and
draws the same states, but it is no longer the only way to install.

The title bar icon is an up arrow rather than a refresh glyph, carries the
pending version in its tooltip, and opens the dialog when there is a release to
open. With nothing pending it starts a check, which is all it ever used to do.

Release notes are the GitHub release body, which
[`scripts/release-notes.mjs`](../scripts/release-notes.mjs) builds from
`CHANGELOG.zh-CN.md`. `frontend/src/components/markdown.tsx` renders the subset
that generator can produce — headings, lists with their wrapped continuations,
emphasis, links, GitHub alert blocks, rules and fences — and degrades anything
else to a paragraph rather than showing its markers. It emits React nodes and
never HTML, because the body is remote content, and it opens links in the
system browser, because the webview has no way back. Tables are the known gap;
`Markdown` is the only export, so swapping the innards for a full parser would
touch one file.

## What it will and will not install

Nothing is installed unverified. Each package is checked against the release's
`SHA256SUMS.txt` while it streams, and the file is only renamed into place once
the digest matches. Three things are refused rather than trusted:

- a release that publishes no checksum list,
- a checksum list that does not name the package this platform needs,
- a download whose digest does not match — the partial file is deleted.

The asset name is computed from the running platform rather than discovered:
`mq-studio-<version>-<mac|windows|linux>-<amd64|arm64>.<dmg|exe|AppImage>`.
`TestPackageNameMatchesTheReleaseWorkflow` pins that to `PACKAGE_BASE` in
`package.yml`, because a rename on the workflow side would otherwise leave
every installed copy hunting for a file that is not attached.

## Replacing the installation

Which is possible depends on how the app was installed, which
`update.Locate()` works out from the executable path and the `APPIMAGE`
environment variable.

| Install | Package | How it is replaced |
| --- | --- | --- |
| macOS `.app` | `.dmg` | `hdiutil attach` read-only, `ditto` the bundle to a staging directory beside the current one, then rename it into place. The old bundle is moved aside first and put back if the swap fails. |
| Linux AppImage | `.AppImage` | Written beside the running image and renamed over it. The rename is atomic and the running process keeps the old inode, so the swap is safe while the app is up. |
| Windows | `.exe` | Handed to the NSIS installer, which runs with its own window. |

Windows goes through the installer rather than swapping the binary on purpose.
The install is machine-wide (`$PROGRAMFILES64`, see `build/windows/nsis/`), so
a replacement needs elevation — and the installer is what knows how to ask for
it, and what owns the uninstall entry and the shortcuts. A per-user install
would allow a silent swap, at the cost of moving every existing installation.

Relaunching is a shell trampoline that polls for this process to disappear
before starting the app, so the old and new copies never overlap. Windows is
left out: its installer owns what happens after the install.

### When it cannot

Four cases are reported rather than attempted, each with its own message and a
link to the releases page instead of a button that would fail:

| Blocker | Meaning |
| --- | --- |
| `packageManager` | A Linux `.deb` / `.rpm` install. Those files belong to apt or dnf and replacing them needs root. |
| `readOnly` | The install location is not writable by this user. |
| `notPackaged` | Not an installed application — a `wails3 dev` run or a bare binary. |
| `unsupported` | No release is built for this OS or architecture. |

These are keys, not prose: the renderer translates them.

## Signing, and what verification does and does not cover

Nothing is code-signed yet (see [RELEASE.md](../RELEASE.md#signing)). What the
updater guarantees today is integrity, not provenance: the package is what the
manifest said it was, fetched over HTTPS. It does not prove the manifest itself
came from whoever should have published it.

Mirrors sharpen that. Because the digests are in the manifest, whoever serves
the manifest decides what counts as a valid package — so every mirror is as
trusted as the release itself. That is acceptable while the mirrors are all
first-party, and it stops being acceptable the moment a third-party CDN is
added. The `signature` field is reserved for an ed25519 signature over the
manifest, with the public key compiled into the build; it needs to land before
any mirror that is not ours does, not after.

One macOS detail worth recording, because it is the opposite of what a
downloaded-installer flow does. Gatekeeper's "damaged, move to Trash" error
comes from the quarantine attribute, which the *downloading* application sets;
Go's HTTP client does not, so a package fetched by the updater carries only
`com.apple.provenance`:

```
$ xattr -l package.dmg
com.apple.provenance:
```

The bundle copied out of it is therefore not quarantined, and an ad-hoc signed
build launches. Self-updating avoids the first-run problem that a browser
download creates rather than inheriting it. That is a property of the current
Gatekeeper rules, not a substitute for signing.

## Where the code is

```
internal/update/
  update.go     The check: version comparison and what the renderer is told
  mirror.go     The mirror list, the manifest, and racing for it
  target.go     Where this build is installed and whether it can be replaced
  download.go   Streaming download, progress, SHA-256 verification
  apply.go      The three replacement routines and the relaunch trampoline
  manager.go    State machine, policy gate, schedule, persisted memory
internal/bridge/update.go       The renderer-facing service
main.go                         Schedule start, and the quit-time install hook
frontend/src/api/updates.ts     Typed calls and the state event
frontend/src/hooks/useUpdater.ts             State, actions, announcing
frontend/src/components/markdown.tsx         Release notes, as the notes are written
frontend/src/lib/updateText.ts               Wording the two update surfaces share
frontend/src/design/shell/UpdateDialog.tsx   Where the update is taken
frontend/src/design/shell/TitleBar.tsx       The icon that announces and opens it
frontend/src/design/boards/settings/UpdateCard.tsx   Settings > 关于
```

`apply.go` carries no build tags. The three routines only assemble command
lines and move files, and a `Location`'s `Kind` can never name the wrong one for
the host, so keeping them buildable everywhere is what lets the whole sequence
be tested with a fake commander on any machine — which matters more than usual
for code whose failure mode is an application that no longer starts.

State reaches the renderer through a single-slot coalescing channel: a download
publishes hundreds of progress states and only the last of any burst is
delivered, in order, off the lock.

## Tests

70 Go tests in `internal/update`, race-clean. They cover the install-shape
rules per platform, checksum parsing in the shapes the tooling emits, download
verification and cancellation, each replacement routine against a fake
commander including the failure paths, mirror selection — that a healthy first
choice leaves the others unasked, that a hung one does not hold up the check,
that a remembered winner is used alone and then re-measured, and that a mirror
serving the wrong bytes is caught and passed over — and the policy ladder end to
end —
that `notify` downloads nothing, that `download` reaches a verified package,
that only `auto` installs at quit, and that a finished download survives a
restart while one the running build has overtaken is thrown away.

On the frontend, `UpdateCard.test.tsx` and `UpdateDialog.test.tsx` render every
phase in both languages, which is also the coverage the board-level i18n test
does not reach — the dialog test mounts the panel rather than the dialog,
because Radix renders content through a portal and server rendering follows
portals nowhere. `markdown.test.tsx` runs a real published release body through
the renderer and asserts that no marker survives to the reader, that a wrapped
bullet stays one bullet, and that a link scheme the app will not open loses its
link rather than its text.

What tests cannot cover was checked by hand against the live release: a real
7 MB asset fetched through a CDN redirect and verified by digest, and a wrong
digest being rejected with the file removed.

## Why not the framework updater

Wails ships `pkg/updater`, wired as `app.Updater`, with a GitHub provider and
its own restart helper. It is not used here for one reason: `extract.go`
handles `.zip` and `.tar.gz` only, and every artifact this project publishes is
an installer — `.dmg`, NSIS `.exe`, `.AppImage`, `.deb`, `.rpm`. Adopting it
would mean publishing a second set of archives aimed at the updater, and giving
up the NSIS path on Windows for a bare binary swap that cannot elevate.

The package is byte-identical between v3.0.0-beta.5 and v3.0.0-beta.16, so this
is not a matter of waiting for a newer release. Worth revisiting if the release
gains archive artifacts for other reasons, or if the extractor learns the
installer formats.
