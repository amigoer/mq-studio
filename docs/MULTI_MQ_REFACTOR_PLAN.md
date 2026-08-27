# 多 MQ 重构执行计划

本文是 [MULTI_MQ_DESIGN.md](MULTI_MQ_DESIGN.md) 的施工版本。设计回答「做成什么
样」，本文回答「按什么顺序、动哪些文件、怎么验收」。

**本次终点：架构就绪，并接入 RabbitMQ 验证抽象成立。** 对应设计文档的阶段 0 到
3，外加把阶段 5 提前。Kafka / Pulsar / Redis Stream / MQTT 的驱动实现仍不在本次
范围内。

第二个驱动选 RabbitMQ 而不是 Kafka，理由见
[实施文档第 0 节](MULTI_MQ_IMPLEMENTATION.md)：Kafka 与 RocketMQ 结构同构，抽象
即使定错也会顺利跑通；RabbitMQ 的驱动实现并不更重（纯 REST 管理面 + 成熟客户端），
但会强制走一遍能力门控、术语解析、整页覆写三条路径。

**状态：待评审，尚未开工。**

## 0. 全局约束

三条贯穿始终的规则，违反其中任何一条就应该停下来重新对齐：

1. **阶段 0 到 3 对用户完全无感。** 每个阶段结束时应用都能正常连接 RocketMQ、
   所有页面行为不变。任何「先破坏再修复」的做法都不接受 —— 这是一次可以随时
   中止的重构。
2. **P0–P4 不新增功能。** 多连接同时在线的 UI、新页面、新能力一律不做，只搬运
   和分层。P5 是唯一的例外，且它新增的东西是**验证手段**：RabbitMQ 驱动本身，
   以及唯一一个整页覆写（Exchanges / Bindings）。
3. **现有测试原样通过。** 测试文件不允许为了迁就重构而修改断言。测试需要改动
   的地方，只能是包路径和构造函数签名。

## 1. 阶段依赖

```text
P0 契约类型 ──► P1 后端驱动端口 ──► P2 存储与 bridge ──► P3 前端分层 ──► P5 RabbitMQ 驱动
                                                                              （验证）
        P4 品牌色拆分 ── 与上面任何阶段并行，互不阻塞
```

P1 必须在 P2 之前：bridge 签名要引用 `driver.Conn`。
P2 必须在 P3 之前：前端要按新 bindings 重写。
P3 必须在 P5 之前：能力门控、术语解析、覆写机制要先存在，才谈得上被验证。
P4 只碰颜色令牌和样式类，与其他阶段无冲突，可以随时插入。

阶段编号跳过 P5 之前的一格是刻意的：它对应设计文档迁移表里的**阶段 5**，我们把
它提前到了阶段 4（Kafka）之前。

## 2. P0 — 契约类型

只新增文件，不改任何现有行为。

| 动作 | 文件 |
| --- | --- |
| 新增 | `internal/model/mqkind.go` — `MQKind` 及六个常量 |
| 新增 | `internal/model/capability.go` — `Capability` 常量集、`Capabilities` |
| 新增 | `internal/model/descriptor.go` — `DriverDescriptor`、`FormField`、`Terms` |
| 新增 | `internal/model/profile.go` — `ConnectionProfile`、`AuthConfig` |
| 新增 | `internal/model/destination.go` — `Destination`、`DestinationRef`、`DestinationSpec` |
| 新增 | `internal/model/subscription.go` — `Subscription`、`SubscriptionRef` |

`DestinationRef` 按设计文档第 9 节待定项 04 落地为结构体：

```go
// DestinationRef identifies a destination across families. Flat families
// leave Namespace empty; Pulsar fills tenant/namespace.
type DestinationRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}
```

**验收**：`go build ./...` 通过；新类型无任何引用（这是预期的）。

## 3. P1 — 后端驱动端口（复用逻辑的落地）

这一阶段的实质是：把 3,725 行驱动专属代码搬进 `internal/driver/rocketmq/`，
让 `internal/service/` 只剩下 2,482 行跨 MQ 通用的业务逻辑。

### 3.1 新建端口

| 动作 | 文件 |
| --- | --- |
| 新增 | `internal/driver/driver.go` — `Driver`、`Conn` |
| 新增 | `internal/driver/ports.go` — 8 个可选能力接口 |
| 新增 | `internal/driver/registry.go` — `kind -> Factory`，以及按连接 ID 的运行时注册表 |
| 新增 | `internal/driver/conformance.go` — 能力声明与接口实现的一致性断言，供各驱动的测试调用 |

### 3.2 搬进驱动的文件（31 个，约 3,725 行）

整包移动，内部实现不改：

```text
internal/rocketmq/client.go                    -> driver/rocketmq/client.go
internal/service/topic/{query,detail,enrich,mutation,stats}.go
internal/service/consumer/{query,broker,enrichment,mutation}.go
internal/service/message/{query,scan,lookup,tracking,command,retry,conversion}.go
internal/service/cluster/{broker,overview}.go
internal/service/acl/{query,mutation,broker,errors}.go
internal/service/internal/mqoffset/query.go
```

另有 4 个文件**不 import 客户端库但语义上属于 RocketMQ**，必须一起搬走，否则
会以「通用工具」的伪装留在 `service/` 里：

| 文件 | 行数 | 为什么是 RocketMQ 专属 |
| --- | --- | --- |
| `topic/parser.go` | 42 | 解析 RocketMQ 的 MessageQueue JSON |
| `message/matching.go` | 51 | 匹配 MessageQueue key |
| `consumer/validation.go` | 23 | 校验 CLUSTERING / BROADCASTING 枚举 |
| `connection/validation.go` | 51 | 校验 NameServer 地址格式 |

### 3.3 留在 service/ 的文件（约 2,482 行）

这些是真正的业务逻辑，本阶段一行都不改，只是它们的依赖从「全局客户端管理器」
变成「注入的 `driver.Conn`」：

- `service/connection/`：`persistence`、`lifecycle`、`mutation`、`reload`、`query`、`service`、`ports`
- `service/configuration/`：全部 6 个文件（导入 / 导出 / 编解码 / 维护）
- `service/settings/`：全部 5 个文件
- `service/cluster/`：`history`、`summary`、`parse`、`service`（TPS 时序与聚合）
- `internal/crypto/`、`internal/storage/`、`internal/update/`
- `service/internal/resource/`、`service/internal/timestamp/`

### 3.4 三处「默认连接」的隐式读取必须清除

这是本阶段最容易漏、也最影响后续的部分。

| 位置 | 现状 | 改成 |
| --- | --- | --- |
| `service/internal/mqexec/retry.go` | 重连时向全局要 `GetDefaultConnection()` | 重试绑定在发起调用的那个 `Conn` 上；`mqexec` 泛化为 `driver/rocketmq` 内部的重试助手 |
| `service/collector/collector.go` | `hasClient` 绑到 `HasActiveDefaultClient` | 保留在 `service/`，`hasClient` 改为注入「注册表中是否有活跃连接」；它本来就是可注入的，只需换实现 |
| `service/connection/lifecycle.go` | `connectRuntimeLocked` 强制把其他连接下线 | 保留单活跃语义（本次不改 UI），但下线逻辑改为显式策略而非副作用，为将来解除做准备 |

**验收**：
- `go build ./... && go test ./...` 全绿，测试断言零改动
- `grep -rn "GetDefaultClient\|GetDefaultConnection\|HasActiveDefaultClient" internal/` 在 `driver/` 之外零命中
- `grep -rn "internal/driver/rocketmq" internal/service/` 零命中（service 不得反向依赖驱动）

## 4. P2 — 存储与 bridge

### 4.1 连接配置迁移

`connections.json` 加载时一次性迁移，无需用户操作：

| 旧字段 | 新位置 |
| --- | --- |
| 无 `kind` | `kind = "rocketmq"` |
| `nameServer` | `endpoints` |
| `enableACL: true` | `auth.mechanism = "acl"` |
| `enableACL: false` | `auth.mechanism = "none"` |
| `accessKey` / `secretKey` | `secrets["accessKey"]` / `secrets["secretKey"]`，**保留原有 `ENC:` 值**，不重新加密 |

同时写入 `schemaVersion`，下一次改动不必再靠字段缺失推断结构。

设置里的 `GlobalAccessKey` / `GlobalSecretKey` 迁到按形态划分的默认值，现有值
落在 `rocketmq` 下。

### 4.2 bridge 方法加连接 ID

现有 49 个 bridge 方法中，**29 个是连接作用域的，全部要加连接 ID 参数**：

| Service | 方法数 | 方法 |
| --- | --- | --- |
| `ClusterService` | 4 | `Info`、`Summary`、`Brokers`、`BrokerDetail` |
| `TopicService` | 7 | `List`、`ListAll`、`Detail`、`Stats`、`Create`、`Update`、`Remove` |
| `ConsumerService` | 6 | `List`、`Detail`、`Stats`、`Create`、`Update`、`Remove`、`ResetOffset` |
| `MessageService` | 7 | `Query`、`ByID`、`Track`、`DLQ`、`Retry`、`Resend`、`Send` |
| `ACLService` | 5 | `Enabled`、`Version`、`UpdateAccess`、`DeleteAccess`、`UpdateWhiteAddrs` |

其余 20 个不是连接作用域的，签名不动：`SystemService`（6）、`SettingsService`
（5）、`ConnectionService`（8）、`WindowService`（1）。

> **这是整个重构中唯一不可推迟的一步。** 它是设计文档第 4.7 节 B 层次的唯一
> 阻塞点，成本曲线单调上升：现在只有一种形态，是一次机械替换；等驱动落地后再
> 补，调用点是三倍，且每个驱动都已围绕「默认连接」写好了自己的假设。
>
> UI 本次仍然单焦点 —— 前端把当前连接的 ID 传进去即可。**但参数必须现在就在
> 签名里。**

### 4.3 服务重命名与新增

| 今天 | 之后 |
| --- | --- |
| `TopicService` | `DestinationService` |
| `ConsumerService` | `SubscriptionService` |
| `ACLService` | `AccessService` |
| `MessageService` / `ClusterService` | 名字不变，载荷改为规范模型 |
| — | `DriverService` — `List()`、`Descriptor(kind)`、`Capabilities(connID)` |

### 4.4 脱敏泛化

`redactConnection` 里写死的 `AccessKeyConfigured` / `SecretKeyConfigured` 改为
`secretsConfigured []string`，由 `Secrets` 的键集合生成。

**验收**：
- 用一份重构前的 `connections.json` 启动，能直接连上，用户无感
- `wails3 generate bindings` 重新生成，`npm run check` 通过
- 已加密的凭据无需重新输入

## 5. P3 — 前端分层（复用页面的落地）

### 5.1 新建 mq/ 层

| 文件 | 职责 |
| --- | --- |
| `mq/types.ts` | 规范 UI 类型 |
| `mq/registry.ts` | `kind -> MqModule` |
| `mq/capabilities.ts` | `useCapabilities()`、`<Capable of="...">` |
| `mq/terms.ts` | `useTerms()`，按形态解析术语并回落到 common |
| `mq/form.ts` | schema 驱动的连接表单渲染器 + 具名校验器表 |
| `mq/rocketmq/` | RocketMQ 的列、表单字段、详情面板、导航贡献 |

### 5.2 页面拆解：哪些留在规范层，哪些下沉到驱动

这是本阶段的核心。每个页面拆成「规范骨架」+「驱动贡献」两部分。行数为**估计**，
第一次真正受检验是 P5 接入 RabbitMQ 的时候。

| 现有页面 | 行数 | 规范页面 | 下沉到 `mq/rocketmq/` 的部分 |
| --- | --- | --- | --- |
| `TopicsPage` | 918 | `DestinationsPage` | 列定义、读写队列数、`Perm` 枚举、`MessageType`、路由表、创建/编辑表单字段 |
| `ConsumersPage` | 904 | `SubscriptionsPage` | `ConsumeMode`、`maxRetry`、重试/死信入口、订阅关系表 |
| `MessagesPage` | 789 | `MessagesPage` | Tag 过滤、消息轨迹（Track）、重发目标选择 |
| `AclPage` | 605 | `AccessPage` | 白名单、RocketMQ 权限模型、ACL 版本探测 |
| `ClusterPage` | 403 | `ClusterPage` | Broker 主从角色、CommitLog 磁盘、运行时指标键名 |
| `ProducerPage` | 377 | `PublishPage` | `tags`、`keys`、`delayLevel` |
| `AlertsPage` | 238 | `AlertsPage` | 无 —— 阈值判定是纯数值比较，整页可复用 |
| `EmptyStatePage` | 500 | `EmptyStatePage` | 文案按术语解析，无逻辑下沉 |
| `ConnectionsPage` | 1041 | `ConnectionsPage` | **约 120 行 NameServer 解析与校验**（`sanitizeHost`、`isIPv4`、`isIPv6`、`isHostname`、`isValidNsHost`、`parseNameServers`、`joinNameServers`）改为驱动注册的具名校验器 |
| `SettingsPage` | 1234 | `SettingsPage` | 全局 ACL 段落改为按形态的默认值段落 |
| `OverviewPage` | 816 | 见下 | — |

**`OverviewPage` 是本阶段唯一的设计缺口。** 它今天聚合 RocketMQ 集群健康度，
对没有集群概念的形态无物可聚。本次的处理方式：拆成「连接摘要（规范）」+
「指标卡片（驱动贡献）」，能力不足时只渲染摘要。这只是让它不阻塞重构，不是
最终答案 —— 设计文档第 9 节待定项 01 仍然待定。

### 5.3 导航改为派生状态

- `Sidebar.GROUPS` 常量删除，改为由「规范页面集按能力过滤」+「模块 nav 贡献」计算
- `App.tsx` 里写死的 `disabledIds` 数组删除
- 无 active 连接时只显示连接与设置

### 5.4 i18n 重组

763 个 key 中的绝大部分原地不动。只有 RocketMQ 专属的迁到 `mq.rocketmq.*`：
队列权限、延迟等级、`%RETRY%` / `%DLQ%` 相关文案、NameServer 字样。同时新增
`mq.common.terms.*` 与 `mq.rocketmq.terms.*` 两组术语键。

**验收**：
- 逐屏对比重构前后，RocketMQ 下的截图应当一致
- `npm run check` 通过
- `grep -rn "NameServer\|nameServer" frontend/src/pages/` 零命中（全部迁到驱动或术语键）

## 6. P4 — 品牌色拆分（去掉绿色主题）

今天 `--success` 同时承担两个角色，这是绿色「洗掉不干净」的根因：品牌强调色和
语义成功色共用一个令牌。

### 6.1 拆令牌

```css
/* index.css */
--brand: 236 40% 46%;         /* 新增：品牌强调色，替代原来的绿 */
--brand-foreground: 0 0% 100%;
--success: 152 55% 36%;       /* 保留：语义成功 / 在线，绿色是通用约定 */
```

深色模式：`--brand: 237 58% 71%`。

`tailwind.config.js` 的 `colors` 增加 `brand`，用法与现有 `success` 一致。

### 6.2 21 个消费点分流

> **施工修正：这份分类原来是错的。** `app.css` 那十几处我写成「焦点环、悬停态、
> 选中边框」，实际全是标题栏连接指示器的在线态 —— `.conn-pill.online`、
> `.item-dot.on`、`.item-check`。它们是**语义色，一处都不该动**。真正的品牌色
> 只有 5 处，下表已按实际代码重排。

**改指向 `--brand`（品牌，去绿）—— 5 处**

| 位置 | 用途 |
| --- | --- |
| `layout/Sidebar.tsx:82` | 选中项底色 + 左侧指示条 |
| `layout/Sidebar.tsx:131` | 更新提醒圆点 |
| `components/ui/switch.tsx:24` | 开关打开态 |
| `pages/OverviewPage.tsx:410` | Topic 吞吐占比条 |
| `index.css:162,165` | `::selection` 选区高亮 |

**保留 `--success`（语义，仍是绿）—— 其余全部**

| 位置 | 用途 |
| --- | --- |
| `styles/app.css:94–141` | 连接胶囊的在线态：圆点、边框、底色、悬停、状态文字、脉冲动画 |
| `styles/app.css:217,218` | 连接菜单项的在线圆点 |
| `styles/app.css:250` | 连接菜单项的勾选标记 |
| `components/ui/badge.tsx:18` | `success` 徽章变体 |
| `index.css:201` | 成功 toast 图标 |

### 6.3 选色说明

`hsl(236 40% 46%)` 是一个偏冷的靛蓝，选它的理由是：**应用正在变成多 broker
客户端，强调色不应该是任何一家的品牌色**（RocketMQ 橙 `#FF6A00`、RabbitMQ 橙、
Kafka 黑都会造成暗示）。它与语义红 / 琥珀 / 绿都不冲突，深浅两色底上都成立。

这是提案色，不是定论 —— 换成任何别的色相都只是改这两行令牌。

**验收**：
- 亮色与深色两种模式各截一遍图，确认无遗留绿色强调
- `grep -rn "bg-success\|text-success\|border-success\|var(--success)" frontend/src/` 的命中全部落在上表的「保留」清单里

## 7. P5 — RabbitMQ 驱动（验证）

这一阶段的目的不是「多支持一种 MQ」，而是**让前面四个阶段的抽象第一次接受真实
检验**。完成判据不是「RabbitMQ 能用」，而是「接它的过程中规范页面没有被迫改
形状」。

### 7.1 为什么是 RabbitMQ

| | Kafka | RabbitMQ |
| --- | --- | --- |
| 管理面协议 | 二进制协议 | 纯 REST / JSON |
| Go 客户端 | `twmb/franz-go` + `pkg/kadm` | `michaelklishin/rabbit-hole/v2` |
| 列表页数据 | Metadata + ListOffsets + OffsetFetch 多次往返 | `GET /api/queues` 一次调用带回深度、消费者数与速率 |
| 积压 | `kadm.Lag` 已封装 | 直接是队列字段 |
| 前置条件 | 无 | 需要启用 management 插件 |
| 驱动工作量 | 中等 | 更小 |
| 前端改动 | 几乎为零 | 新增 Exchanges/Bindings 页 + 能力门控路径 |
| **验证价值** | **低** —— 结构同构 | **高** —— 无 offset、无分区、破坏性浏览、需整页覆写 |

RabbitMQ 的额外成本全在前端，而那部分成本正是验证本身。Kafka 一条设计路径都
走不到。

### 7.2 会被验证的三条设计

| 设计 | RabbitMQ 触发它的方式 |
| --- | --- |
| 能力门控（第 4.3 节） | 不声明 `subscription.resetOffset`、`destination.partitions`、`message.byId` |
| 术语解析（第 5.3 节） | destination 术语是 Queue 而不是 Topic |
| 整页覆写规则（第 3 节） | Exchanges / Bindings 页在别的形态没有对应物 |

### 7.3 浏览是状态变更的，UI 必须说明

RabbitMQ 官方文档对 `POST /api/queues/{vhost}/{name}/get` 的原话是「这不是
HTTP GET，因为它会改变队列状态」。即使 `ackmode=reject_requeue_true` 重新入队，
`redelivered` 标记和消息位置也会变。

所以规范 Messages 页不能直接套用 —— 这是设计文档 `Degraded` 机制第一次派上真实
用场：能力声明为支持，但附带说明，UI 给出提示而不是静默执行。

### 7.4 失败信号

**这一阶段最有价值的产出是失败信号，不是功能。** 出现下面任何一种情况，说明
抽象层次定错了，应当停下来改设计而不是硬接：

- 规范页面为了容纳 RabbitMQ 需要改变结构（不只是加列或加字段）
- 某个概念既塞不进 `Options` 也塞不进驱动贡献
- 能力门控无法表达「有这个概念但语义不同」（例如积压有值但不是 offset 差）
- Exchanges 页之外还需要第二个整页覆写

**验收**：
- 同时配置 RocketMQ 与 RabbitMQ 两个连接，切换时导航、术语、能力门控三处都正确
- `git diff --stat` 显示规范页面零改动或仅新增可选字段
- RabbitMQ 下不出现任何 offset / 分区 / 消息轨迹相关的控件

## 8. 不在本次范围内

明确列出来，避免范围蔓延：

- Kafka / Pulsar / Redis Stream / MQTT 的驱动实现
- 多连接同时在线的 UI（导航归属、跨连接聚合）—— 契约层支持，UI 仍单焦点
- 设计文档第 9 节的 5 项待定决策 —— 除了 `DestinationRef`（P0 落地）和
  `OverviewPage`（P3 临时处理），其余保持待定
- 流式通道（实时 tail）
- P0–P4 内的任何新功能；P5 的新增仅限验证所需

## 9. 主要风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| **规范页面的抽象层次定错** | P3 的拆分白做，P5 返工 | 把 RabbitMQ 提前到第二个驱动，就是为了让这个风险**尽早暴露**而不是被 Kafka 掩盖。此外 P3 动手前先在纸上把 RabbitMQ 的 Queues 页和 MQTT 的导航套进 5.2 比一遍 |
| RabbitMQ 环境不可用 | P5 无法开发和验证 | 提交 24 先建 `tests/e2e/rabbitmq/` 的 docker 环境（`rabbitmq:*-management` 镜像），不依赖外部集群 |
| management 插件未启用 | 驱动在真实环境里能力大面积缺失 | 连接时探测 `/api/overview`，探测不到就用 `Degraded` 明确说明原因，而不是静默隐藏页面 |
| bindings 重新生成引发大面积 TS 报错 | P2 到 P3 之间出现一个不可编译的窗口 | P2 结束时前端先用最小改动跟上新签名（只传当前连接 ID），把重构留到 P3 |
| 「伪通用」文件被漏掉 | 驱动逻辑留在 `service/`，P5 才暴露 | 3.2 已列出 4 个已知的；P1 验收时逐文件复核 `service/` 剩余文件的语义，而不只看 import |
| `OverviewPage` 缺口 | P3 卡住 | 已定临时方案（摘要 + 驱动卡片），不追求最终答案 |
