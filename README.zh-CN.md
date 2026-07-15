# Rocket Leaf

<p align="center">
  <img src="desktop/src/renderer/assets/logo.png" alt="Rocket Leaf" width="160">
</p>

RocketMQ 4.x / 5.x 跨平台桌面管理客户端，支持 macOS、Windows 和 Linux。应用采用 Electron 桌面进程与 Go 本地守护进程协作，用户安装和启动的仍然是一个完整应用。

## 主要能力

- 多集群连接、NameServer 与 ACL 凭证管理
- Topic、消费者组、消息查询、消息轨迹、重投和试发
- Broker、NameServer、吞吐与堆积状态查看
- ACL 配置、客户端告警、主题与字体设置
- 本地配置导入导出和 Electron 自动更新

所有数据继续保存在操作系统用户配置目录的 `rocket-leaf/` 下。连接和全局凭证使用本地 AES-256-GCM 密钥加密；导出的迁移文件包含明文凭证，应作为敏感文件保管。

## 开发

依赖 Go 1.25、Node.js 22 和 npm。

推荐通过根目录 Makefile 使用统一入口：

```bash
make help              # 查看全部命令
make install           # 安装依赖
make dev               # 启动开发环境
make run               # 构建并临时运行，不生成安装包
make build             # 构建 daemon 与 Electron
make test              # 单元测试与 daemon 冒烟测试
make check             # 完整静态检查与基础测试
make package           # 生成当前平台内部测试安装包
make icons             # 从 icon-source.png 重新生成各平台图标
```

```bash
npm install
npm install --prefix desktop

npm run dev             # Electron + Vite，开发时自动 go run daemon
npm run generate:api    # 根据 OpenAPI 生成 TypeScript 类型
npm run build           # 构建当前平台 daemon 与 Electron
npm run package         # 生成当前平台安装包
npm run check           # 格式、Go、TypeScript、测试与契约检查
```

后端可独立运行和测试：

```bash
cd daemon
go test ./...
go run ./cmd/rocket-leafd
```

`rocket-leafd` 不是公共服务。它只监听随机回环端口，必须由 Electron 通过 stdin 注入一次性令牌后启动。

### RocketMQ 端到端测试

```bash
make e2e-up             # 启动并保留环境
make test-e2e           # 对已运行的环境执行测试
make e2e-down           # 手动停止并清理

make e2e                # 启动、测试并自动清理
```

测试会启动真实 Electron、随行 Go daemon 和 RocketMQ 5.3.2，覆盖连接、集群发现、
Topic 创建、消息发送、Key 查询及消息详情回查。Electron 使用临时用户目录，不会修改
本机已有的 Rocket Leaf 配置。

## 目录结构

```text
desktop/                 Electron 应用
  src/main/              主进程（窗口、daemon 托管、IPC）
  src/preload/           contextBridge 暴露面
  src/renderer/          React 界面
    api/                 渲染进程后端调用
    components/          通用组件
    hooks/               Hooks / Provider
    layout/              标题栏与侧边栏
    pages/               业务页面
    styles/              全局样式与主题预加载
  src/shared/            main / preload 共享类型
  src/generated/         OpenAPI 生成类型
daemon/                  Go 模块 (github.com/amigoer/rocket-leaf/daemon)
  cmd/rocket-leafd/      进程入口
  internal/api/          私有回环 HTTP API
  internal/app/          服务组装
  internal/service/      领域服务
  internal/model/        领域模型
  internal/rocketmq/     RocketMQ 客户端适配
  internal/crypto/       本地加密
contracts/               OpenAPI 契约
scripts/                 构建、启动、图标、冒烟测试
tests/e2e/               共享 RocketMQ 端到端环境
docs/                    架构与路线图
release/                 本地安装包产物（不提交）
```

### scripts/

| 脚本 | 作用 |
| --- | --- |
| `run-electron.sh` | 统一启动：`dev` / `run`（含 macOS 临时应用包准备） |
| `build-daemon.sh` | 按平台/架构编译 daemon 到 `desktop/resources/bin` |
| `package.sh` | 构建并打当前平台内部测试安装包 |
| `generate-icons.sh` | 从 `desktop/resources/icon-source.png` 生成 PNG/ICNS/ICO |
| `generate-icns.mjs` | 图标脚本内部使用的 ICNS 转换 |
| `smoke-daemon.mjs` | daemon 启动、鉴权与退出冒烟测试 |

## CI 与发布

GitHub Actions 已按 Electron + Go daemon 配置：

| Workflow | 触发 | 作用 |
| --- | --- | --- |
| [CI](.github/workflows/ci.yml) | push / PR | 质量检查，并构建各平台**未签名**安装包产物 |
| [Release](.github/workflows/release.yml) | 手动 `workflow_dispatch` | 按 tag 构建签名包并创建 GitHub Release |

Release 需要在 GitHub Environment `release` 中配置密钥：

- macOS：`MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- Windows：`WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD`

本地打包：

```bash
make package   # 当前平台、未签名内部测试包 → release/
```

详细设计见 [架构说明](docs/ARCHITECTURE.md) 和 [路线图](docs/ROADMAP.md)。
