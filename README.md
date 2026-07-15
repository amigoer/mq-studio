# Rocket-Leaf

<p align="center">
  <img src="desktop/src/renderer/assets/logo.png" alt="Rocket-Leaf" width="160">
</p>

<p align="center">
  <strong>A local desktop client for RocketMQ</strong><br>
  Browse topics, consumers, and messages without a web console.
</p>

<p align="center">
  Windows · macOS · Linux &nbsp;·&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;·&nbsp;
  <a href="https://github.com/amigoer/rocket-leaf/releases">Releases</a>
</p>

---

## Why Rocket-Leaf?

- **Local-first** — runs on your machine; no server to deploy, no management port to expose
- **Day-to-day ops** — connections, topics, consumer groups, message query, produce, cluster health
- **Private by default** — profiles and settings stay on disk; secrets encrypted at rest

Supports RocketMQ **4.x / 5.x** (via Admin APIs). UI language: **English / 中文**.

## Features

| Area            | What you can do                                                            |
| --------------- | -------------------------------------------------------------------------- |
| **Connections** | Multi-cluster profiles, default + auto-connect, multi-NameServer, ACL keys |
| **Overview**    | TPS, lag, broker health, shortcuts into other screens                      |
| **Topics**      | List / filter / detail / route stats; create, update, delete               |
| **Consumers**   | Groups, clients, lag; reset offset; group config CRUD                      |
| **Messages**    | Query by topic, key, tag, message ID, time; traces; resend; DLQ / retry    |
| **Producer**    | Send test messages (tag, key, body, delay level)                           |
| **Cluster**     | Brokers, NameServers, runtime metrics, throughput trends                   |
| **Alerts**      | Client-side rules (lag, disk, …) from live data                            |
| **ACL**         | Access configs and global whitelist (when the broker supports it)          |
| **Settings**    | Theme, fonts, timeouts, import / export full config                        |

## Download

Get the **latest release** and download **one** file for your machine:

| Platform                        | File                                      |
| ------------------------------- | ----------------------------------------- |
| macOS Apple Silicon (M1/M2/M3…) | `rocket-leaf-macos-arm64.app.zip`         |
| macOS Intel                     | `rocket-leaf-macos-amd64.app.zip`         |
| Windows x64                     | `rocket-leaf-windows-amd64-installer.exe` |
| Windows ARM64                   | `rocket-leaf-windows-arm64-installer.exe` |
| Linux x64                       | `rocket-leaf-linux-amd64.AppImage`        |
| Linux ARM64                     | `rocket-leaf-linux-arm64.AppImage`        |

**Install**

- **macOS** — unzip → drag into Applications → open (right-click → Open the first time if Gatekeeper blocks)
- **Windows** — run the installer
- **Linux** — `chmod +x rocket-leaf-linux-*.AppImage && ./rocket-leaf-linux-*.AppImage`

## Quick start

1. Open the app → **Connections** (or add a connection from Overview).
2. Set **NameServer** (required). Separate multiple addresses with `;`, `,`, or spaces. Add AccessKey / SecretKey if ACL is on.
3. **Save** → **Connect**, then use Topics, Consumers, Messages, and the rest from the sidebar.

### Data on disk

Everything is stored under the OS user config directory in `rocket-leaf/`:

| File               | Purpose                          |
| ------------------ | -------------------------------- |
| `connections.json` | Connection profiles              |
| `settings.json`    | App settings                     |
| `secret.key`       | Local encryption key for secrets |

Typical paths: macOS `~/Library/Application Support/rocket-leaf/` · Linux `~/.config/rocket-leaf/` · Windows `%AppData%\rocket-leaf\`

Credentials are **encrypted at rest**. A full config **export** is for migration and contains **plaintext** secrets — treat that JSON as sensitive (file mode `0600` when written by the app).

## Development

**Prerequisites:** Go (see `go.mod`), Node.js 20+, [Task](https://taskfile.dev/), [Wails v3](https://wails.io/) CLI.

```bash
npm install
npm --prefix frontend install

task dev          # desktop + Vite hot reload
task build        # build for current OS
task package      # platform package
npm run check     # format, gofmt, vet, type-check
```

Optional helpers (need a reachable NameServer):

```bash
go run ./scripts/seed-data [nameServer] [duration_sec] [rate_per_sec]
go run ./scripts/inspect-cluster ...
```

## Docs

| Doc                                  | Content                       |
| ------------------------------------ | ----------------------------- |
| [Architecture](docs/ARCHITECTURE.md) | Stack, layout, security notes |
| [Roadmap](docs/ROADMAP.md)           | What’s done and what’s next   |

Issues and PRs are welcome.

## License

[MIT](LICENSE) · [amigoer/rocket-leaf](https://github.com/amigoer/rocket-leaf)
