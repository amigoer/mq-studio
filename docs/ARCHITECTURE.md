# Rocket Leaf v2 架构

## 进程边界

```text
React Renderer（无 Node 权限）
        │ contextBridge
Electron Preload
        │ 受限 IPC 操作
Electron Main ── 窗口 / 对话框 / 外链 / 自动更新
        │ Bearer Token + 回环 HTTP
rocket-leafd
        │
RocketMQ Admin API / 本地配置与加密存储
```

Electron Main 是操作系统能力和后端进程的唯一所有者。Renderer 不接触 Node.js、IPC 原语、daemon 端口、认证令牌、任意文件路径或导出的明文配置。

## Daemon 启动协议

1. Electron 生成 32 字节随机令牌并启动 `rocket-leafd`。
2. 令牌以单行 JSON 写入 stdin，不出现在命令行和日志中。
3. daemon 监听 `127.0.0.1:0`，通过 stdout 返回协议版本、端口、PID 和应用版本。
4. 每个 `/v1` 请求必须携带 Bearer Token；错误统一返回 `code`、`message`、`requestId` 和可选 `details`。
5. Electron 退出时调用关闭接口并等待五秒；stdin 提前关闭也会使 daemon 退出，防止孤儿进程。

## 接口和数据安全

- `contracts/openapi.yaml` 是唯一跨进程契约，TypeScript 类型生成到 `desktop/src/generated/`。
- 保存过的 AccessKey 和 SecretKey 永不返回 Renderer，只返回 `Configured` 状态。
- 更新连接或全局设置时明确使用 `preserve`、`replace`、`clear` 三种凭证模式。
- 配置文件路径和内容只在 Electron Main 与 daemon 之间流转。
- 生产页面通过 `app://rocket-leaf` 加载，启用上下文隔离、沙箱、CSP、导航限制和外链域名白名单。

## 构建边界

`desktop/` 与 `daemon/` 拥有各自依赖和测试。发布脚本按目标平台编译一个 Go 二进制，并由 Electron Builder 作为 ASAR 外的 `extraResources/bin` 打入同一个安装包。应用 ID 保持 `com.rocketleaf.app`，本地数据目录保持 `rocket-leaf`，因此 v1 数据无需迁移。
