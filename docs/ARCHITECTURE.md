# Rocket Leaf Architecture

## Process boundaries

```text
React Renderer (no Node access)
        │ contextBridge
Electron Preload
        │ restricted IPC operations
Electron Main ── window / dialogs / external links / auto-update
        │ Bearer token + loopback HTTP
rocket-leafd
        │
RocketMQ Admin API / local encrypted settings
```

Electron Main owns OS capabilities and the backend process. The Renderer never touches Node.js, raw IPC primitives, the daemon port, auth tokens, arbitrary file paths, or exported plaintext config.

## Daemon startup protocol

1. Electron generates a 32-byte random token and starts `rocket-leafd`.
2. The token is written as a single-line JSON object on stdin (never on the command line or logs).
3. The daemon listens on `127.0.0.1:0` and prints protocol version, port, PID, and app version on stdout.
4. Every `/v1` request must include the Bearer token. Errors return `code`, `message`, `requestId`, and optional `details`.
5. On Electron exit the main process calls the shutdown API and waits up to five seconds; closing stdin also terminates the daemon to avoid orphans.

## API and data safety

- `contracts/openapi.yaml` is the single cross-process contract. TypeScript types are generated into `desktop/src/generated/`.
- Saved AccessKey / SecretKey values are never returned to the Renderer; only a configured flag is exposed.
- Connection and settings updates use explicit credential modes: `preserve`, `replace`, and `clear`.
- Config paths and contents only move between Electron Main and the daemon.
- Production UI is served from `app://rocket-leaf` with context isolation, sandbox, CSP, navigation limits, and an external-link host allowlist.

## Repository layout

```text
desktop/                 Electron application
  src/main/              Main process (window, daemon supervisor, IPC)
  src/preload/           contextBridge surface
  src/renderer/          React UI
    api/                 Renderer → Main backend calls
    components/          Shared UI components
    hooks/               React hooks / providers
    layout/              Title bar and sidebar chrome
    pages/               Feature pages
    styles/              Global CSS and early theme bootstrap
  src/shared/            Types shared by main and preload
  src/generated/         OpenAPI-generated types
daemon/                  Go module (github.com/amigoer/rocket-leaf/daemon)
  cmd/rocket-leafd/      Process entrypoint
  internal/api/          Private loopback HTTP API
  internal/app/          Service wiring
  internal/service/      Domain services
  internal/model/        Domain models
  internal/rocketmq/     RocketMQ client adapter
  internal/crypto/       Local encryption helpers
contracts/               OpenAPI contract
scripts/                 Build, run, icons, smoke tests
tests/e2e/               Shared RocketMQ e2e environment
```

## Build boundary

`desktop/` and `daemon/` keep separate dependencies and tests. Release packaging compiles one Go binary per target platform and embeds it outside the ASAR as `extraResources/bin`. The app id stays `com.rocketleaf.app` and the user data directory stays `rocket-leaf`, so v1 local data remains compatible.
