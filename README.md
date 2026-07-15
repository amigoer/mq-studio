# Rocket Leaf

Rocket Leaf is a cross-platform RocketMQ 4.x / 5.x desktop client built with Electron and a private local Go daemon.

It supports connection profiles, topics, consumer groups, messages, cluster metrics, ACL management, locally encrypted credentials, configuration migration, and automatic updates on macOS, Windows, and Linux.

## Repository layout

```text
desktop/     Electron main, preload, React renderer, packaging
daemon/      Go module (github.com/amigoer/rocket-leaf/daemon)
contracts/   OpenAPI contract between main process and daemon
scripts/     Build, run, icons, smoke tests
tests/e2e/   Shared RocketMQ end-to-end environment
docs/        Architecture and roadmap
```

## Quick start

```bash
make install
make dev
```

See the [简体中文说明](README.zh-CN.md) for development, architecture, security, and packaging details.
