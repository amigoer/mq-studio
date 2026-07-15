# Rocket-Leaf

<p align="center">
  <img src="desktop/src/renderer/assets/logo.png" alt="Rocket-Leaf" width="150">
</p>

<p align="center">
  <strong>A local-first desktop client for RocketMQ</strong><br>
  Manage clusters, topics, consumers, and messages without deploying a separate console.
</p>

<p align="center">
  <a href="https://github.com/amigoer/rocket-leaf/releases/latest"><img src="https://img.shields.io/github/v/release/amigoer/rocket-leaf?style=flat-square&label=release" alt="Latest release"></a>
  <a href="https://github.com/amigoer/rocket-leaf/releases"><img src="https://img.shields.io/github/downloads/amigoer/rocket-leaf/total?style=flat-square&label=downloads" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/amigoer/rocket-leaf?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-39404A?style=flat-square" alt="Platforms">
  <img src="https://img.shields.io/badge/RocketMQ-4.x%20%7C%205.x-FF6A00?style=flat-square" alt="RocketMQ 4.x and 5.x">
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/amigoer/rocket-leaf/releases">Download</a> ·
  <a href="docs/ARCHITECTURE.md">Documentation</a>
</p>

---

## Why Rocket-Leaf?

- **Ready to use** — no server or web console to deploy
- **Built for daily operations** — common RocketMQ tasks in one desktop app
- **Private by default** — configuration stays on your device and credentials are encrypted at rest
- **Cross-platform** — macOS, Windows, and Linux with English and Chinese interfaces

## Features

| Area | What you can do |
| --- | --- |
| **Connections** | Manage multiple clusters, NameServers, auto-connect, and ACL credentials |
| **Topics & Messages** | Create and inspect topics; query, trace, resend, and produce messages |
| **Consumers** | View groups, clients, subscriptions, and lag; reset offsets; handle retry and DLQ |
| **Cluster & Alerts** | Monitor brokers, runtime metrics, throughput, lag, disk usage, and desktop alerts |
| **Administration** | Manage consumer settings, Topic settings, ACL, and global whitelist |
| **Personalization** | Switch theme and language, customize display, and import or export configuration |

Supports RocketMQ **4.x / 5.x** through Admin APIs. ACL and some advanced operations depend on the broker version and configuration.

## Download

Download the latest package from **[GitHub Releases](https://github.com/amigoer/rocket-leaf/releases)**:

| Platform | Package |
| --- | --- |
| macOS Apple Silicon / Intel | `.dmg` or `.zip` |
| Windows x64 / ARM64 | `.exe` installer |
| Linux x64 / ARM64 | `.AppImage` |

## Quick start

1. Open Rocket Leaf and create a connection.
2. Enter one or more NameServer addresses and optional ACL credentials.
3. Save, connect, and choose a feature from the sidebar.

Your profiles and settings stay in the local user configuration directory. Configuration exports contain plaintext credentials and should be stored securely.

## Development

Requires Go 1.25+, Node.js 20+, and npm.

```bash
npm install
npm install --prefix desktop
make dev
```

Use `make check` to run project checks, `make package` to create an installer, and `make help` to list all commands.

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)

## License

[MIT](LICENSE) © [amigoer](https://github.com/amigoer)
