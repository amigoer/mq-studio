## Install / 安装

| Platform | File | Notes |
| --- | --- | --- |
| macOS Apple Silicon | `*-mac-arm64.dmg` | Open, drag into Applications |
| macOS Intel | `*-mac-amd64.dmg` | Open, drag into Applications |
| Windows x64 / ARM64 | `*-windows-amd64.exe` / `*-windows-arm64.exe` | Run the installer |
| Debian / Ubuntu | `*-linux-<arch>.deb` | `sudo apt install ./<file>.deb` |
| Fedora / RHEL | `*-linux-<arch>.rpm` | `sudo dnf install ./<file>.rpm` |
| Any Linux | `*-linux-<arch>.AppImage` | `chmod +x` then run |

`SHA256SUMS.txt` lists the checksum of every file above. Verify with
`shasum -a 256 -c SHA256SUMS.txt` (macOS/Linux) or
`Get-FileHash <file> -Algorithm SHA256` (Windows).

Full instructions, including first launch on each platform:
[INSTALL](https://github.com/amigoer/mq-studio/blob/main/docs/INSTALL.md) ·
[安装说明](https://github.com/amigoer/mq-studio/blob/main/docs/INSTALL.zh-CN.md)
