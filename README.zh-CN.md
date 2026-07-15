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

### OrbStack RocketMQ 端到端测试

```bash
npm run e2e:up
npm run test:e2e
npm run e2e:down
```

测试会启动真实 Electron、随行 Go daemon 和 RocketMQ 5.3.2，覆盖连接、集群发现、
Topic 创建、消息发送、Key 查询及消息详情回查。Electron 使用临时用户目录，不会修改
本机已有的 Rocket Leaf 配置。

## 目录

```text
desktop/             Electron Main、Preload、React Renderer 与打包配置
daemon/              Go 守护进程及 RocketMQ 业务实现
contracts/           两个进程之间的 OpenAPI 契约
scripts/             构建、代码生成与发布编排
release/             本地安装包产物（不提交）
```

详细设计见 [架构说明](docs/ARCHITECTURE.md) 和 [路线图](docs/ROADMAP.md)。
