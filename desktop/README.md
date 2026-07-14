# Rocket Leaf Desktop

该目录是独立 Electron 工程：

- `src/main`：窗口、daemon supervisor、受限 IPC、对话框和自动更新
- `src/preload`：通过 `contextBridge` 暴露最小桌面 API
- `src/renderer`：React 界面，不启用 Node.js
- `src/generated`：由 `contracts/openapi.yaml` 生成的接口类型
- `resources`：应用图标和发布时注入的 daemon 二进制

开发时执行 `npm run dev`。如果未设置 `ROCKET_LEAF_DAEMON_PATH` 且不存在预构建二进制，主进程会在相邻的 `daemon/` 目录执行 `go run ./cmd/rocket-leafd`。
