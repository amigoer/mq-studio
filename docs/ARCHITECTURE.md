# Rocket-Leaf 技术架构

本文档描述 **当前代码库** 的技术架构，与实现保持同步。若实现变更，请同步更新本文档。

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                         Rocket-Leaf                          │
├──────────────────────────────────────────────────────────────┤
│  Frontend (React 18 + TypeScript)                            │
│  ┌──────────┐  ┌─────────┐  ┌────────┐  ┌─────────────────┐ │
│  │ redesign │  │  hooks  │  │  api   │  │ i18n (en / zh)  │ │
│  │ screens  │  │ Context │  │ 薄封装  │  │                 │ │
│  └────┬─────┘  └────┬────┘  └───┬────┘  └────────┬────────┘ │
│       └─────────────┴───────────┴─────────────────┘          │
│                           │                                  │
│              Wails 3 bindings + runtime                      │
│                           │                                  │
├───────────────────────────┼──────────────────────────────────┤
│  Backend (Go)             │                                  │
│  ┌────────────────┐  ┌────┴───────────┐  ┌────────────────┐ │
│  │ internal/      │  │ internal/      │  │ internal/      │ │
│  │ service/*      │  │ rocketmq      │  │ crypto         │ │
│  │ (Wails 服务)   │→ │ ClientManager │  │ AES-256-GCM    │ │
│  └────────────────┘  └───────┬───────┘  └────────────────┘ │
│  ┌────────────────┐          │          ┌────────────────┐ │
│  │ internal/model │          │          │ 本地 JSON 文件  │ │
│  │ (DTO)          │          ▼          │ connections /  │ │
│  └────────────────┘  rocketmq-admin-go  │ settings / key │ │
│                      rocketmq-client-go └────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

应用形态：

- **桌面客户端**（默认）：Wails v3 嵌入前端静态资源，系统 WebView 渲染 UI
- **可选 server / Docker 模式**：无 GUI 的 HTTP 服务形态（见根目录 `Taskfile.yml` 的 `build:server`、`run:docker` 等任务）

---

## 技术选型

### 前端

| 技术                       | 用途             | 说明                                |
| -------------------------- | ---------------- | ----------------------------------- |
| React 18                   | UI 框架          | 实际界面实现                        |
| TypeScript                 | 语言             | 类型安全                            |
| Vite 7                     | 构建与开发服务器 | Wails dev 联动                      |
| Tailwind CSS 4             | 样式             | 设计系统与暗色主题                  |
| Radix UI + shadcn 风格组件 | 基础交互组件     | `components/ui/*`                   |
| lucide-react               | 图标             | 侧栏与页面图标                      |
| i18next / react-i18next    | 国际化           | `en` / `zh`                         |
| recharts                   | 图表             | 吞吐等趋势展示                      |
| sonner                     | Toast            | 操作反馈                            |
| @wailsio/runtime           | 桌面运行时       | 窗口、打开外链等                    |
| Wails 生成 bindings        | 调用 Go          | `frontend/bindings/rocket-leaf/...` |

### 后端

| 技术                                    | 用途                 | 说明                           |
| --------------------------------------- | -------------------- | ------------------------------ |
| Go（见 `go.mod`）                       | 后端语言             | 业务与 Admin 调用              |
| Wails v3                                | 桌面框架             | 服务绑定 + 资源嵌入            |
| github.com/amigoer/rocketmq-admin-go    | RocketMQ Admin       | Topic / 消费者 / 消息 / ACL 等 |
| github.com/apache/rocketmq-client-go/v2 | 生产与部分客户端能力 | 发送消息等                     |
| 本地 JSON                               | 配置持久化           | 非 SQLite                      |
| AES-256-GCM                             | 敏感字段加密         | AccessKey / SecretKey          |

### 工程与发布

| 技术                     | 用途                                          |
| ------------------------ | --------------------------------------------- |
| Taskfile                 | `task dev` / `task build` / `task package` 等 |
| GitHub Actions           | 跨平台构建与 Release                          |
| husky + prettier + gofmt | 提交前格式化与检查                            |
| `npm run check`          | format / gofmt / go vet / frontend type-check |

---

## 目录结构（与仓库一致）

```
rocket-leaf/
├── main.go                         # 应用入口：初始化 crypto / services，注册 Wails Service
├── go.mod / go.sum
├── Taskfile.yml                    # 聚合各平台构建任务
├── package.json                    # 根级脚本（format、check、husky）
├── README.md / README.zh-CN.md
│
├── docs/
│   ├── ARCHITECTURE.md             # 本文档
│   ├── ROADMAP.md                  # 功能状态与后续规划
│   └── images/                     # README 截图与 logo
│
├── internal/
│   ├── crypto/                     # AES-256-GCM，密钥 secret.key
│   ├── model/                      # 前后端共享 DTO（连接、Topic、消息、设置等）
│   ├── rocketmq/
│   │   └── client.go               # AdminClientManager：客户端池、默认连接、懒初始化
│   └── service/                    # Wails 暴露的业务服务
│       ├── connection_service.go
│       ├── cluster_service.go
│       ├── topic_service.go
│       ├── consumer_service.go
│       ├── message_service.go
│       ├── settings_service.go
│       ├── acl_service.go
│       └── client_retry.go         # 断线自动重连并重试一次
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── bindings/                   # Wails 生成的 TS 绑定（勿手改业务逻辑）
│   ├── dist/                       # 构建产物（嵌入 Go 二进制）
│   └── src/
│       ├── main.tsx                # React 入口
│       ├── App.tsx                 # 壳：TitleBar + Sidebar + 页面切换
│       ├── api/                    # 对 bindings 的薄封装
│       ├── hooks/                  # 数据与 UI 状态（Context / hooks）
│       ├── redesign/               # 当前主 UI
│       │   ├── TitleBar.tsx
│       │   ├── Sidebar.tsx
│       │   ├── shell.tsx
│       │   └── screens/            # Overview / Topics / Consumers / ...
│       ├── components/             # 通用组件 + 部分历史视图（Spinner、ui 等仍在用）
│       ├── i18n/                   # 语言包
│       └── lib/utils.ts
│
├── build/                          # 各平台打包资源与 Taskfile
│   ├── config.yml                  # Wails 应用元数据与 dev_mode
│   ├── darwin/ / windows/ / linux/
│   ├── android/ / ios/             # 移动端脚手架（非桌面主路径）
│   └── docker/
│
├── scripts/                        # 本地调试辅助
│   ├── seed-data/                  # 灌流量演示
│   ├── produce/                    # 发消息
│   ├── inspect-cluster/            # 查看集群
│   └── check-gofmt.sh
│
└── .github/workflows/
    ├── build-test.yml              # 跨平台构建
    └── release.yml                 # 发布
```

---

## 后端服务与职责

`main.go` 在 `init` 中创建服务实例，并在 Wails `Services` 中注册。前端通过生成的 bindings 调用导出方法。

| 服务                | 主要能力                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| `ConnectionService` | 连接 CRUD、测试、连接/断开、默认连接、JSON 持久化（敏感字段加密）               |
| `ClusterService`    | 集群信息、Broker 列表与运行时指标、NameServer、摘要、TPS 历史采样               |
| `TopicService`      | Topic 列表/详情/路由/统计、创建/更新/删除                                       |
| `ConsumerService`   | 消费者组列表/详情、消费进度、重置 Offset、客户端列表、组的增删改                |
| `MessageService`    | 按 Topic/Key/Tag/时间查询、按 MsgID 查询、轨迹、重发、DLQ/Retry、发送（含延时） |
| `SettingsService`   | 应用设置读写、导入/导出、清缓存；超时与拉取限制等供其他服务读取                 |
| `AclService`        | ACL 开关/版本、AccessConfig 增删改、全局白名单                                  |

### RocketMQ 客户端管理

`internal/rocketmq.AdminClientManager`：

- 按 NameServer 地址缓存 Admin 客户端
- 支持 **默认连接** 与 **懒初始化**（业务首次访问时通过 `ConnectionService.ConnectDefault` 建立）
- 应用退出时 `CloseAll()` 释放资源
- 服务层 `executeWithClientRetry` 在可重试网络错误时移除旧客户端并重连重试一次

---

## 前后端通信

### Go 侧

服务方法导出后，Wails 生成 TypeScript 绑定，例如：

```go
// internal/service/connection_service.go
func (s *ConnectionService) GetConnections() []*model.Connection { ... }
func (s *ConnectionService) Connect(id int) error { ... }
```

### 前端调用链

```
Screen (redesign/screens/*)
  → hooks/* / 直接 api/*
    → frontend/src/api/*.ts
      → frontend/bindings/rocket-leaf/internal/service/*
        → Go Service 方法
```

示例：

```typescript
// frontend/src/api/connection.ts
import * as ConnectionService from '../../bindings/rocket-leaf/internal/service/connectionservice.js'

export async function getConnections() {
  return await ConnectionService.GetConnections()
}
```

页面导航不使用 React Router：`App.tsx` 用 `activeNav` 状态切换 `redesign/screens/*`。未连接时，除 Overview / Connections / Settings 外展示空状态，并禁用相关侧栏项。

---

## 数据存储

配置目录名：`rocket-leaf`（`os.UserConfigDir()` 下）。

| 文件               | 内容                                     |
| ------------------ | ---------------------------------------- |
| `connections.json` | 连接列表（AccessKey/SecretKey 加密存储） |
| `settings.json`    | 主题、语言、超时、告警阈值、消息展示等   |
| `secret.key`       | AES 主密钥（首次启动生成，权限 0600）    |

典型路径：

| 平台    | 目录                                         |
| ------- | -------------------------------------------- |
| macOS   | `~/Library/Application Support/rocket-leaf/` |
| Linux   | `~/.config/rocket-leaf/`                     |
| Windows | `%AppData%\rocket-leaf\`                     |

### 敏感信息

- `internal/crypto`：AES-256-GCM，密文带 `ENC:` 前缀
- 字段级密钥由主密钥派生
- 空字符串不加密

### 连接模型（摘要）

```json
{
  "connections": [
    {
      "id": 1,
      "name": "生产环境",
      "env": "生产",
      "nameServer": "192.168.1.100:9876",
      "timeoutSec": 5,
      "enableACL": true,
      "accessKey": "ENC:...",
      "secretKey": "ENC:...",
      "status": "offline",
      "isDefault": true,
      "remark": ""
    }
  ]
}
```

---

## 前端界面结构

侧栏导航（`redesign/Sidebar.tsx`）：

| NavId         | 屏幕              | 说明                             |
| ------------- | ----------------- | -------------------------------- |
| `home`        | OverviewScreen    | 吞吐概览、统计卡片、快捷入口     |
| `topics`      | TopicsScreen      | Topic 管理                       |
| `consumers`   | ConsumersScreen   | 消费者组                         |
| `messages`    | MessagesScreen    | 消息查询                         |
| `producer`    | ProducerScreen    | 发送测试消息                     |
| `cluster`     | ClusterScreen     | 集群与 Broker                    |
| `alerts`      | AlertsScreen      | 基于概览数据与阈值的本地告警列表 |
| `acl`         | AclScreen         | ACL 配置                         |
| `connections` | ConnectionsScreen | 连接管理                         |
| `settings`    | SettingsScreen    | 应用设置                         |

说明：

- **Alerts** 为前端根据 Overview / 设置中的 `lagAlertThreshold` 等规则派生，不是独立告警后端
- `components/*View.tsx` 等为历史视图；主路径以 `redesign/` 为准，部分通用件（如 `Spinner`、`ui/*`）仍被 redesign 复用

### 主题与 i18n

- 主题：`settings.theme` 为 `system` | `light` | `dark`，配合 CSS / Tailwind 变量
- 语言：`settings.language` 为 `en` | `zh`，文案在 `frontend/src/i18n/locales/`

---

## 安全考虑

1. **敏感数据加密**：连接与全局设置中的密钥类字段本地加密
2. **本地运行**：不强制公网暴露管理端口
3. **配置导入导出**：经 `SettingsService` 统一处理，便于备份迁移
4. **ACL 写操作**：前端对覆盖白名单等危险操作要求二次确认

---

## 开发与构建入口

```bash
# 桌面开发（Wails + Vite）
task dev

# 当前平台构建 / 打包
task build
task package

# 质量检查
npm run check

# 仅前端
cd frontend && npm install && npm run dev
cd frontend && npm run build
```

辅助脚本（需可访问的 NameServer）：

```bash
go run ./scripts/seed-data [nameServer] [duration_sec] [rate_per_sec]
go run ./scripts/produce ...
go run ./scripts/inspect-cluster ...
```

---

## 维护约定

更新代码时若涉及下列变更，请同步改本文档与 `docs/ROADMAP.md`：

- 技术栈（框架、状态管理、存储介质）
- 目录布局或主 UI 入口（`redesign` 等）
- Wails 注册的 Service 列表与对外能力
- 本地配置文件路径或加密方案
- 发布产物形态（平台、包格式）
