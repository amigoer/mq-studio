# Rocket-Leaf

<p align="center">
  <img src="docs/images/logo.png" alt="Rocket-Leaf Logo" width="180">
</p>

<p align="center">
  <strong>A lightweight, polished desktop client for RocketMQ</strong>
</p>

<p align="center">
  Windows · macOS · Linux
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

## What is Rocket-Leaf?

Rocket-Leaf is a **local desktop app** for connecting to and managing RocketMQ clusters. It helps you inspect topics, monitor consumers, query messages, and send test messages without deploying a web console or exposing management ports.

- **Ready to use**: download and launch directly
- **Cross-platform**: available on Windows, macOS, and Linux
- **Local-first data**: connection profiles and settings stay on your machine and are easy to back up

## Features

| Capability                | Description                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| **Overview**              | Cluster snapshot, produce/consume TPS, lag summary, and quick actions                     |
| **Connection Management** | Multiple clusters, default connection, ACL credentials, local persistence with encryption |
| **Topics**                | Browse, search, inspect route/stats, create, update, and delete                           |
| **Consumer Groups**       | List groups, offsets, clients, reset progress, create/update/delete group config          |
| **Messages**              | Query by Topic / Key / Tag / MessageId / time range, traces, resend, DLQ & retry          |
| **Producer**              | Send test messages with tags, keys, body, and delay levels                                |
| **Cluster**               | Brokers, NameServers, runtime stats, and throughput trends                                |
| **Alerts**                | Client-side rules (e.g. lag / disk thresholds) based on live cluster data                 |
| **ACL**                   | Access configs and global whitelist (when the broker supports ACL admin APIs)             |
| **Settings**              | Theme, language (en/zh), timeouts, display options, import/export config                  |

## Stack

| Layer         | Tech                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| Desktop shell | [Wails v3](https://wails.io/)                                          |
| Backend       | Go + [rocketmq-admin-go](https://github.com/amigoer/rocketmq-admin-go) |
| Frontend      | React 18, TypeScript, Vite, Tailwind CSS                               |
| Storage       | Local JSON under the user config dir (AES-256-GCM for secrets)         |

Details: [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)

## Downloads

Download **one** package for your machine from [Releases](https://github.com/amigoer/rocket-leaf/releases):

| Platform                            | File                                      |
| ----------------------------------- | ----------------------------------------- |
| **macOS Apple Silicon (M1/M2/M3…)** | `rocket-leaf-macos-arm64.app.zip`         |
| **macOS Intel**                     | `rocket-leaf-macos-amd64.app.zip`         |
| **Windows x64**                     | `rocket-leaf-windows-amd64-installer.exe` |
| **Windows ARM64**                   | `rocket-leaf-windows-arm64-installer.exe` |
| **Linux x64**                       | `rocket-leaf-linux-amd64.AppImage`        |
| **Linux ARM64**                     | `rocket-leaf-linux-arm64.AppImage`        |

- **macOS**: unzip → drag into Applications → open (use right-click → Open the first time if needed).
- **Windows**: run the installer.
- **Linux**: `chmod +x rocket-leaf-linux-*.AppImage && ./rocket-leaf-linux-*.AppImage`

## Quick Start

1. Launch the app and open **Connections** (or add a connection from Overview).
2. Enter cluster details: **NameServer** is required (multiple addresses can be separated by `;`, `,`, or whitespace); fill AccessKey/SecretKey if ACL is enabled.
3. Save and **Connect**. Use Topics, Consumers, Messages, Producer, Cluster, and ACL from the sidebar.

Connection profiles and settings are stored locally. Local credentials are encrypted at rest. A full configuration export contains plaintext credentials for cross-device migration, so treat the exported JSON as a sensitive file.

<details>
<summary>Local data locations</summary>

Under the OS user config directory, folder `rocket-leaf/`:

| File               | Purpose                             |
| ------------------ | ----------------------------------- |
| `connections.json` | Connection profiles                 |
| `settings.json`    | App settings                        |
| `secret.key`       | Encryption key for sensitive fields |

Typical paths:

- **macOS**: `~/Library/Application Support/rocket-leaf/`
- **Linux**: `~/.config/rocket-leaf/`
- **Windows**: `%AppData%\rocket-leaf\`

</details>

## Development

Prerequisites: Go (see `go.mod`), Node.js 20+, [Task](https://taskfile.dev/), Wails v3 CLI.

```bash
# Install frontend deps (also run from repo root scripts as needed)
npm install
npm --prefix frontend install

# Desktop dev (Wails + Vite)
task dev

# Build / package for current OS
task build
task package

# Lint / format / type-check
npm run check
```

Optional local helpers (need a reachable NameServer):

```bash
go run ./scripts/seed-data [nameServer] [duration_sec] [rate_per_sec]
go run ./scripts/inspect-cluster ...
```

## Roadmap and Contributing

- Status and next steps: [Roadmap](docs/ROADMAP.md)
- Stack and layout: [Architecture](docs/ARCHITECTURE.md)
- Issues and pull requests are welcome

## License

[MIT](LICENSE) · [amigoer/rocket-leaf](https://github.com/amigoer/rocket-leaf)
