# Rocket-Leaf

<p align="center">
  <img src="docs/images/logo.png" alt="Rocket-Leaf" width="160">
</p>

<p align="center">
  <strong>本地运行的 RocketMQ 桌面客户端</strong><br>
  管理 Topic、消费者与消息，无需额外部署 Web 控制台。
</p>

<p align="center">
  Windows · macOS · Linux &nbsp;·&nbsp;
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="https://github.com/amigoer/rocket-leaf/releases">Releases</a>
</p>

---

## 为什么用 Rocket-Leaf？

- **本地优先** — 安装即用，不用部署服务端，也不必暴露管理端口
- **日常运维** — 连接、Topic、消费组、消息查询、试发、集群健康
- **数据在本机** — 配置与设置只存在当前设备；密钥本地加密存储

支持 RocketMQ **4.x / 5.x**（Admin API）。界面语言：**中文 / English**。

## 功能

| 模块         | 能力                                                                |
| ------------ | ------------------------------------------------------------------- |
| **连接**     | 多集群、默认连接 / 启动自动连接、多 NameServer、ACL 凭证            |
| **概览**     | TPS、堆积、Broker 状态与快捷入口                                    |
| **Topic**    | 列表 / 筛选 / 详情与路由；创建、更新、删除                          |
| **消费者组** | 组与客户端、堆积；重置位点；组配置增删改                            |
| **消息**     | 按 Topic / Key / Tag / MessageId / 时间查询；轨迹；重发；DLQ / 重试 |
| **生产者**   | 试发（Tag、Key、Body、延时级别）                                    |
| **集群**     | Broker、NameServer、运行时指标与吞吐趋势                            |
| **告警**     | 基于实时数据的客户端规则（堆积、磁盘等）                            |
| **ACL**      | AccessConfig 与全局白名单（需 Broker 支持相关接口）                 |
| **设置**     | 主题、字体、超时、配置导入 / 导出                                   |

## 下载

打开 **[Releases](https://github.com/amigoer/rocket-leaf/releases)**，按系统 **只下一个文件**：

| 平台                          | 文件                                      |
| ----------------------------- | ----------------------------------------- |
| macOS Apple Silicon（M 系列） | `rocket-leaf-macos-arm64.app.zip`         |
| macOS Intel                   | `rocket-leaf-macos-amd64.app.zip`         |
| Windows x64                   | `rocket-leaf-windows-amd64-installer.exe` |
| Windows ARM64                 | `rocket-leaf-windows-arm64-installer.exe` |
| Linux x64                     | `rocket-leaf-linux-amd64.AppImage`        |
| Linux ARM64                   | `rocket-leaf-linux-arm64.AppImage`        |

**安装方式**

- **macOS** — 解压 → 拖到「应用程序」→ 打开（若被拦截：右键 → 打开）
- **Windows** — 运行安装包
- **Linux** — `chmod +x rocket-leaf-linux-*.AppImage && ./rocket-leaf-linux-*.AppImage`

## 快速开始

1. 打开应用 → **连接**（或从概览添加连接）。
2. 填写 **NameServer**（必填）。多个地址可用 `;`、`,` 或空格分隔。若开启 ACL，再填 AccessKey / SecretKey。
3. **保存** → **连接**，然后从侧边栏使用 Topic、消费者、消息等功能。

### 本地数据

数据在系统用户配置目录下的 `rocket-leaf/`：

| 文件               | 用途             |
| ------------------ | ---------------- |
| `connections.json` | 连接配置         |
| `settings.json`    | 应用设置         |
| `secret.key`       | 敏感字段加密密钥 |

常见路径：macOS `~/Library/Application Support/rocket-leaf/` · Linux `~/.config/rocket-leaf/` · Windows `%AppData%\rocket-leaf\`

凭证在本地 **加密存储**。全量配置 **导出** 用于跨设备迁移，文件中含 **明文** 密钥，请按敏感文件保管（应用写入时权限为 `0600`）。

## 开发

**依赖：** Go（见 `go.mod`）、Node.js 20+、[Task](https://taskfile.dev/)、[Wails v3](https://wails.io/) CLI。

```bash
npm install
npm --prefix frontend install

task dev          # 桌面开发 + 前端热更新
task build        # 当前平台构建
task package      # 打包
npm run check     # 格式化 / gofmt / vet / 类型检查
```

可选脚本（需可访问的 NameServer）：

```bash
go run ./scripts/seed-data [nameServer] [duration_sec] [rate_per_sec]
go run ./scripts/inspect-cluster ...
```

## 文档

| 文档                             | 内容                   |
| -------------------------------- | ---------------------- |
| [架构说明](docs/ARCHITECTURE.md) | 技术栈、目录与安全说明 |
| [路线图](docs/ROADMAP.md)        | 已完成与后续规划       |

欢迎提交 Issue 与 PR。

## 许可证

[MIT](LICENSE) · [amigoer/rocket-leaf](https://github.com/amigoer/rocket-leaf)
