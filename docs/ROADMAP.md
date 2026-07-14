# Rocket Leaf 路线图

## v2.0.0

- 完成 Wails 到 Electron + Go daemon 的桌面架构迁移
- 保持 RocketMQ 业务、本地配置和加密格式兼容
- 支持 macOS、Windows、Linux 的 x64 与 arm64 安装包
- 建立 OpenAPI 契约、私有回环鉴权和敏感字段脱敏
- 支持提示后下载、提示后重启的自动更新流程

## 后续候选

- 补充真实安装包环境的 Playwright Electron 端到端测试
- 建立更新下载进度和 daemon 故障恢复的专用 UI
- 收集回环 API P50/P95 基线；仅在 P95 超过 10ms 时评估 Unix Socket 或 Named Pipe
- 扩展 RocketMQ 5.x Proxy 与更多 ACL 管理能力
