# Rocket-Leaf

<p align="center">
  <img src="desktop/src/renderer/assets/logo.png" alt="Rocket-Leaf" width="160">
</p>

<p align="center">
  <strong>本地优先的 RocketMQ 桌面客户端</strong><br>
  无需额外部署控制台，即可管理集群、Topic、消费者与消息。
</p>

<p align="center">
  Windows · macOS · Linux &nbsp;·&nbsp;
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="https://github.com/amigoer/rocket-leaf/releases">Releases</a>
</p>

---

## 为什么用 Rocket-Leaf？

- **本地优先** — Electron 应用与内置 Go 守护进程都在本机运行，无需部署服务端
- **集中运维** — 在一个应用内管理连接、Topic、消费者、消息、ACL 与集群健康
- **安全设计** — 渲染进程运行在沙箱中，守护进程只接受带认证的本机回环请求，敏感信息加密存储
- **跨平台** — 提供 macOS、Windows 与 Linux 安装包

通过 Admin API 支持 RocketMQ **4.x / 5.x**。ACL 与部分高级操作是否可用，取决于 Broker 版本和配置。界面语言：**中文 / English**。

## 功能

| 模块         | 能力                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| **连接**     | 多集群配置、默认连接与启动自动连接、多 NameServer、连接级及全局 ACL 凭证              |
| **概览**     | 集群统计、Broker 健康、消费堆积与常用操作快捷入口                                     |
| **Topic**    | 搜索、路由与统计查看，以及创建、更新、删除                                             |
| **消费者组** | 查看组、客户端、订阅与堆积；编辑配置；重置位点；处理重试与死信消息                    |
| **消息**     | 按 Topic、Key、Tag、Message ID、时间查询；查看内容与轨迹；重发                         |
| **生产者**   | 发送测试消息，支持 Tag、Key、自定义消息体与延时级别                                   |
| **集群**     | 查看 Broker、NameServer、运行时指标与吞吐趋势                                         |
| **告警**     | 基于实时数据检测 Broker、消费者、堆积、死信与磁盘状态，并可发送桌面通知               |
| **ACL**      | 在 Broker 支持时管理访问配置与全局白名单                                              |
| **设置**     | 主题、语言、字体、时区、超时、全局凭证、配置导入导出与应用更新                        |

## 下载

打开 **[Releases](https://github.com/amigoer/rocket-leaf/releases)**，选择与你的系统匹配的安装包：

| 平台                          | 安装包                  |
| ----------------------------- | ----------------------- |
| macOS Apple Silicon（M 系列） | ARM64 `.dmg` 或 `.zip`  |
| macOS Intel                   | x64 `.dmg` 或 `.zip`    |
| Windows x64 / ARM64           | NSIS 安装包（`.exe`）   |
| Linux x64 / ARM64             | `.AppImage`             |

**安装方式**

- **macOS** — 打开 DMG，将 Rocket Leaf 拖入「应用程序」；也可以直接解压 ZIP
- **Windows** — 运行安装包并按向导完成安装
- **Linux** — 为 AppImage 添加执行权限后运行：`chmod +x "Rocket Leaf"-*.AppImage`

## 快速开始

1. 打开 Rocket Leaf，进入 **连接**。
2. 新建连接并至少填写一个 **NameServer** 地址；多个地址可用 `;`、`,` 或空格分隔。
3. 需要 ACL 时填写当前连接的凭证，或者在 **设置** 中配置可复用的全局凭证。
4. 保存并连接，然后从侧边栏使用 Topic、消费者、消息、生产者、集群、告警与 ACL 等功能。

### 本地数据

应用数据保存在系统用户配置目录下的 `rocket-leaf/` 中：

| 文件               | 用途                         |
| ------------------ | ---------------------------- |
| `connections.json` | 连接配置                     |
| `settings.json`    | 应用设置与全局凭证           |
| `secret.key`       | 用于加密敏感字段的本地密钥   |

常见路径：macOS `~/Library/Application Support/rocket-leaf/` · Linux `~/.config/rocket-leaf/` · Windows `%AppData%\rocket-leaf\`

凭证在本地 **加密存储**，保存后不会再暴露给渲染进程。全量配置 **导出** 主要用于迁移，其中包含 **明文密钥**，请按敏感文件妥善保管。在操作系统支持时，应用写出的文件权限为 `0600`。

## 开发

**依赖：** Go 1.25+（见 `daemon/go.mod`）、Node.js `^20.19.0 || >=22.12.0`、npm。只有端到端测试需要 Docker。

```bash
npm install
npm install --prefix desktop

make dev       # Electron 开发模式，同时启动 Go 守护进程
make build     # 构建守护进程与桌面应用
make package   # 为当前平台生成安装包
make check     # 格式检查、vet、类型检查、测试与 API 契约校验
make e2e       # 使用 Docker 测试集群运行端到端测试
```

React 渲染进程不能直接访问 Node.js。Electron preload 只暴露受限的 IPC 接口，主进程通过带认证的本机回环 HTTP 与 `rocket-leafd` 通信。TypeScript API 类型由 `contracts/openapi.yaml` 生成。

运行 `make help` 可以查看全部可用命令。

## 文档

| 文档                             | 内容                         |
| -------------------------------- | ---------------------------- |
| [架构说明](docs/ARCHITECTURE.md) | 组件、进程边界与安全设计     |
| [路线图](docs/ROADMAP.md)        | 已完成内容与后续改进计划     |

欢迎提交 Issue 与 PR。

## 许可证

[MIT](LICENSE) · [amigoer/rocket-leaf](https://github.com/amigoer/rocket-leaf)
