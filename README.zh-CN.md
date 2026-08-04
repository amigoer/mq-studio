# Rocket-Leaf

<p align="center">
  <img src="frontend/src/assets/logo.png" alt="Rocket-Leaf" width="150">
</p>

<p align="center">
  <strong>本地优先的 RocketMQ 桌面客户端</strong><br>
  无需额外部署控制台，即可管理集群、Topic、消费者与消息。
</p>

<p align="center">
  <a href="https://github.com/amigoer/rocket-leaf/releases/latest"><img src="https://img.shields.io/github/v/release/amigoer/rocket-leaf?style=flat-square&label=release" alt="最新版本"></a>
  <a href="https://github.com/amigoer/rocket-leaf/releases"><img src="https://img.shields.io/github/downloads/amigoer/rocket-leaf/total?style=flat-square&label=downloads" alt="下载量"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-39404A?style=flat-square" alt="支持平台">
  <img src="https://img.shields.io/badge/RocketMQ-4.x%20%7C%205.x-FF6A00?style=flat-square" alt="RocketMQ 4.x 与 5.x">
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="https://github.com/amigoer/rocket-leaf/releases">下载</a> ·
  <a href="docs/ARCHITECTURE.md">文档</a>
</p>

---

<p align="center">
  <a href="docs/images/overview.png">
    <img src="docs/images/overview.png" alt="Rocket-Leaf 概览仪表盘">
  </a>
  <br>
  <sub>在一个页面查看集群健康、实时吞吐、消费堆积与 Broker 状态。</sub>
</p>

## 为什么用 Rocket-Leaf？

- **安装即用** — 不需要部署服务端或 Web 控制台
- **专注日常运维** — 一个桌面应用覆盖常用 RocketMQ 操作
- **数据留在本机** — 配置保存在当前设备，凭证加密存储
- **跨平台与双语** — 支持 macOS、Windows、Linux 以及中英文界面

## 功能

| 模块 | 能力 |
| --- | --- |
| **连接** | 管理多个集群、NameServer、自动连接与 ACL 凭证 |
| **Topic 与消息** | 创建和查看 Topic；查询、追踪、重发与生产消息 |
| **消费者** | 查看消费组、客户端、订阅与堆积；重置位点；处理重试与死信消息 |
| **集群与告警** | 监控 Broker、运行指标、吞吐、堆积、磁盘状态与桌面告警 |
| **管理能力** | 管理消费者配置、Topic 配置、ACL 与全局白名单 |
| **个性化** | 切换主题与语言、自定义显示、导入或导出配置 |

通过 Admin API 支持 RocketMQ **4.x / 5.x**。ACL 与部分高级操作是否可用，取决于 Broker 版本和配置。

## 产品一览

点击任意截图可查看完整尺寸原图。

<table>
  <tr>
    <td width="50%" align="center">
      <a href="docs/images/topics.png"><img src="docs/images/topics.png" alt="Topic 管理"></a>
      <br><sub><strong>Topic 操作</strong> — 查看队列、路由与订阅关系。</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/images/consumers.png"><img src="docs/images/consumers.png" alt="消费者组详情"></a>
      <br><sub><strong>消费诊断</strong> — 跟踪客户端、订阅、TPS 与消息堆积。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/images/messages.png"><img src="docs/images/messages.png" alt="消息查询与详情"></a>
      <br><sub><strong>消息检查</strong> — 查询消息并查看消息体、属性与轨迹。</sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/images/cluster.png"><img src="docs/images/cluster.png" alt="集群监控"></a>
      <br><sub><strong>集群监控</strong> — 查看健康状态、吞吐、Broker 与磁盘使用率。</sub>
    </td>
  </tr>
</table>

## 下载

前往 **[GitHub Releases](https://github.com/amigoer/rocket-leaf/releases)** 下载最新版本：

| 平台 | 安装包 |
| --- | --- |
| macOS Apple Silicon / Intel | `.dmg` |
| Windows x64 / ARM64 | `.exe` 安装包 |
| Linux x64 / ARM64 | `.AppImage` |

## 快速开始

1. 打开 Rocket Leaf，新建连接。
2. 填写一个或多个 NameServer 地址，需要时添加 ACL 凭证。
3. 保存并连接，然后从侧边栏选择需要的功能。

连接与设置保存在本机用户配置目录中。导出的配置包含明文凭证，请作为敏感文件妥善保管。

## 开发

需要 Go 1.25+、Node.js 20+、npm 与 [Wails 3 CLI](https://v3.wails.io)。

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
make install
make dev
```

使用 `make check` 运行项目检查，使用 `make package` 生成安装包，使用 `make help` 查看全部命令。

## 文档

[架构说明](docs/ARCHITECTURE.md) · [路线图](docs/ROADMAP.md)

## 许可证

[Apache-2.0](LICENSE) © 2026 [amigoer](https://github.com/amigoer)
