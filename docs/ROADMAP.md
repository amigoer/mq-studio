# Roadmap

## v0.1.0

Versioning restarts below 1.0 with the Wails 3 rewrite: the earlier 1.x line
was built on a different architecture and is no longer published.

- Migrate from Electron + local Go daemon back to Wails 3
- Replace the loopback HTTP transport with in-process Wails bindings
- Keep RocketMQ features, local settings, and encryption format compatible
- Ship macOS, Windows, and Linux packages
- Keep sensitive-field redaction in the bridge layer

## Later candidates

- Restore end-to-end UI coverage. The Playwright suite drove Electron through
  its CDP endpoint and was removed with it; the platform WebViews offer no
  equivalent on macOS. Options worth evaluating: driving the Linux WebKitGTK
  build in CI, or covering the same flows as Go integration tests against the
  `tests/e2e/rocketmq` environment.
- Dedicated UI for update download progress
- Broader RocketMQ 5.x Proxy and ACL management features
