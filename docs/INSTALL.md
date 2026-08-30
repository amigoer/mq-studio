# Installing MQ Studio

Packages are named `mq-studio-<version>-<os>-<arch>.<ext>`. Download them from
[Releases](https://github.com/amigoer/mq-studio/releases).

Every release ships `SHA256SUMS.txt`. To verify a download:

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

On Windows: `Get-FileHash <file> -Algorithm SHA256` and compare by eye.

---

## macOS

Requires macOS 12 or later. Pick `arm64` for Apple silicon, `amd64` for Intel
Macs — About This Mac tells you which you have.

1. Open the `.dmg`.
2. Drag **MQ Studio** onto the **Applications** folder in the same window.
3. Double-click **首次运行 First Run** in that window.
4. Eject the disk image.

### Why step 3 exists

MQ Studio is not yet signed with an Apple Developer ID. macOS marks anything
downloaded from a browser with a quarantine flag, and that flag is copied along
with the app when you drag it out of the disk image. For an app without a
registered developer signature, Gatekeeper does not offer to open it anyway — it
reports that the app **"is damaged and can't be opened"** and offers only to
move it to the Trash. The app is not damaged; that is the message macOS uses
when it cannot identify the signer.

The First Run helper removes the quarantine flag, which is all that is needed.
It only has to be run once per install.

**If the helper itself is blocked**, right-click (or Control-click) it and
choose **Open** — that path still works for scripts. If that fails too, open
Terminal and paste:

```bash
xattr -dr com.apple.quarantine "/Applications/MQ Studio.app"
```

That command always works, on every macOS version. It is exactly what the
helper does.

This whole section goes away once the app is signed and notarised.

### Local network access

The first time MQ Studio connects to a broker on your LAN, macOS asks for Local
Network permission. **Allow it** — if it is denied, connections do not report a
permission error, they simply time out.

macOS ties that permission to the app's code signature. Because the current
builds are ad-hoc signed, the signature changes with every build, so you may be
asked again after each update.

---

## Windows

Requires Windows 10 (Server 2016) or later. Run
`mq-studio-<version>-windows-<arch>.exe`.

The installer is not code-signed yet, so SmartScreen shows "Windows protected
your PC". Click **More info** → **Run anyway**.

It installs to `Program Files`, adds Start Menu and Desktop shortcuts, installs
the WebView2 runtime if it is missing, and registers an entry under Apps &
features for uninstalling.

---

## Linux

Requires GTK 4 and WebKitGTK 6.0 — Ubuntu 24.04 or later, Debian 13 or later, and
equivalent releases elsewhere. Earlier distributions ship WebKit2GTK 4.1 and cannot run
these packages. The packages are `libgtk-4-1` and `libwebkitgtk-6.0-4` on Debian and
Ubuntu, `gtk4` and `webkitgtk6.0` on Fedora and RHEL.

**Debian, Ubuntu:**

```bash
sudo apt install ./mq-studio-<version>-linux-<arch>.deb
```

**Fedora, RHEL, AlmaLinux, Rocky:**

```bash
sudo dnf install ./mq-studio-<version>-linux-<arch>.rpm
```

Both add MQ Studio to the application menu.

**AppImage** — works anywhere, but does not add a menu entry on its own:

```bash
chmod +x mq-studio-<version>-linux-<arch>.AppImage
./mq-studio-<version>-linux-<arch>.AppImage
```

---

## Where your data lives

Connection profiles and settings stay in your local user configuration
directory. Credentials are encrypted at rest. Configuration *exports* contain
plaintext credentials — store them somewhere safe.
