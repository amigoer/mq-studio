# Rocket-Leaf

<p align="center">
  <img src="desktop/src/renderer/assets/logo.png" alt="Rocket-Leaf" width="160">
</p>

<p align="center">
  <strong>A local-first desktop client for RocketMQ</strong><br>
  Operate clusters, topics, consumers, and messages without deploying a separate console.
</p>

<p align="center">
  Windows · macOS · Linux &nbsp;·&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;·&nbsp;
  <a href="https://github.com/amigoer/rocket-leaf/releases">Releases</a>
</p>

---

## Why Rocket-Leaf?

- **Local-first** — the Electron app and bundled Go daemon run on your machine; there is no server to deploy
- **Operations in one place** — manage connections, topics, consumers, messages, ACL, and cluster health
- **Secure by design** — the renderer is sandboxed, daemon access is limited to authenticated loopback requests, and secrets are encrypted at rest
- **Cross-platform** — native packages for macOS, Windows, and Linux

Supports RocketMQ **4.x / 5.x** through Admin APIs. ACL and advanced operations depend on the broker version and configuration. UI language: **English / 中文**.

## Features

| Area            | What you can do                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| **Connections** | Multi-cluster profiles, default and auto-connect, multi-NameServer, per-connection and global ACL keys |
| **Overview**    | Cluster statistics, broker health, consumer lag, and shortcuts to common operations                  |
| **Topics**      | Search, inspect routes and statistics, create, update, and delete                                    |
| **Consumers**   | Inspect groups, clients, subscriptions, and lag; edit config; reset offsets; handle retry and DLQ    |
| **Messages**    | Query by topic, key, tag, message ID, and time; inspect payload and trace; resend                     |
| **Producer**    | Send test messages with tags, keys, custom bodies, and delay levels                                  |
| **Cluster**     | Inspect brokers, NameServers, runtime metrics, and throughput trends                                 |
| **Alerts**      | Evaluate live broker, consumer, lag, DLQ, and disk rules with optional desktop notifications         |
| **ACL**         | Manage access configurations and global whitelist entries when supported by the broker              |
| **Settings**    | Theme, language, fonts, time zone, timeouts, global credentials, config import/export, and updates   |

## Download

Open the **[Releases](https://github.com/amigoer/rocket-leaf/releases)** page and choose the package for your system:

| Platform                        | Package                  |
| ------------------------------- | ------------------------ |
| macOS Apple Silicon (M series)  | ARM64 `.dmg` or `.zip`   |
| macOS Intel                     | x64 `.dmg` or `.zip`     |
| Windows x64 / ARM64             | NSIS installer (`.exe`)  |
| Linux x64 / ARM64               | `.AppImage`              |

**Install**

- **macOS** — open the DMG and move Rocket Leaf to Applications, or extract the ZIP
- **Windows** — run the installer and follow the setup wizard
- **Linux** — make the AppImage executable, then launch it: `chmod +x "Rocket Leaf"-*.AppImage`

## Quick start

1. Open Rocket Leaf and go to **Connections**.
2. Add a profile and enter at least one **NameServer** address. Separate multiple addresses with `;`, `,`, or spaces.
3. Add connection-specific ACL credentials if required, or configure reusable global credentials in **Settings**.
4. Save and connect. You can then use Topics, Consumers, Messages, Producer, Cluster, Alerts, and ACL from the sidebar.

### Data on disk

Application data is stored under the OS user config directory in `rocket-leaf/`:

| File               | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `connections.json` | Connection profiles                          |
| `settings.json`    | Application settings and global credentials  |
| `secret.key`       | Local key used to encrypt sensitive fields   |

Typical paths: macOS `~/Library/Application Support/rocket-leaf/` · Linux `~/.config/rocket-leaf/` · Windows `%AppData%\rocket-leaf\`

Credentials are **encrypted at rest** and are not exposed to the renderer after they are saved. A full configuration **export** is intended for migration and contains **plaintext secrets**; treat the exported JSON as sensitive. Files written by the app use mode `0600` where the operating system supports it.

## Development

**Prerequisites:** Go 1.25+ (see `daemon/go.mod`), Node.js `^20.19.0 || >=22.12.0`, and npm. Docker is only required for end-to-end tests.

```bash
npm install
npm install --prefix desktop

make dev       # Electron development mode with the Go daemon
make build     # Build the daemon and desktop application
make package   # Create an installer for the current platform
make check     # Format, vet, type-check, test, and verify API contracts
make e2e       # Run end-to-end tests with the Docker test cluster
```

The React renderer has no direct Node.js access. Electron preload exposes a restricted IPC API, while the main process communicates with `rocket-leafd` over authenticated loopback HTTP. TypeScript API types are generated from `contracts/openapi.yaml`.

Run `make help` to see all available commands.

## Docs

| Doc                                  | Content                                      |
| ------------------------------------ | -------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md) | Components, process boundaries, and security |
| [Roadmap](docs/ROADMAP.md)           | Completed work and planned improvements      |

Issues and PRs are welcome.

## License

[MIT](LICENSE) · [amigoer/rocket-leaf](https://github.com/amigoer/rocket-leaf)
