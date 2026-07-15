# Roadmap

## v2.0.0

- Migrate from Wails to Electron + local Go daemon
- Keep RocketMQ features, local settings, and encryption format compatible
- Ship macOS, Windows, and Linux packages for x64 and arm64
- Establish OpenAPI contract, private loopback auth, and sensitive-field redaction
- Support prompt-to-download / prompt-to-restart auto-update

## Later candidates

- Expand Playwright Electron e2e coverage against packaged builds
- Dedicated UI for update download progress and daemon recovery
- Collect loopback API P50/P95 baselines; only evaluate Unix sockets if P95 exceeds 10ms
- Broader RocketMQ 5.x Proxy and ACL management features
