# 多 MQ 架构设计

目标形态共 15 种，分三档。

**自托管**：RocketMQ（现有）、Kafka、RabbitMQ、Pulsar、ActiveMQ / Artemis、
Redis Stream、NATS、NSQ、MQTT。

**云托管**：Amazon SQS、Google Cloud Pub/Sub、Azure Service Bus、Amazon Kinesis。
这一档没有可拨的 broker 地址：凭证与 region 走 `ConnectionProfile` 的 `Options`
与 `Secrets`，`Endpoints` 留空。

**企业**：IBM MQ、Solace PubSub+。

### 不单列形态的两类

**协议兼容的实现由已有驱动覆盖**，不占用新的 `MQKind`：Redpanda、AutoMQ、
WarpStream、Confluent、Amazon MSK、Azure Event Hubs 走 Kafka；EMQX、Mosquitto、
HiveMQ、VerneMQ 走 MQTT；Amazon MQ 走 ActiveMQ 或 RabbitMQ；阿里云与腾讯云的
RocketMQ 走 RocketMQ。实现之间的差异靠 `probe()` 收窄能力表达，而不是靠新增
驱动 —— 第 9 节里 RabbitMQ 用「管理插件是否启用」收窄能力，是同一个手法。

> EMQX 与 HiveMQ 是这条规则下最需要留意的一例。MQTT 形态按协议本身建模，只有
> 发布与订阅；但这些实现各自带完整 REST 管理面，probe 成功时可以把目标列表与
> 订阅列表补回来。能力差异因此是运行时事实，不是形态差异。

**明确不做**：ZeroMQ 与 nanomsg 没有 broker，也就没有管理面可言；Celery、
Sidekiq、BullMQ 是架在 Redis 或 RabbitMQ 之上的应用层任务队列，不是消息中间件
本身，要做也是另一条产品线而不是一个驱动。

本文在任何代码移动之前，先定义 Go 与渲染层之间的契约。它是一份设计而不是变更
记录：下面每一个接口都是待确认的提案，文末的迁移计划才是把它变成提交的部分。

## 1. 单类型假设究竟藏在哪里

它并不集中在某一个适配器里，而是横跨四层，每一层的处理方式都不同。

| 层 | 耦合点 | 代码位置 |
| --- | --- | --- |
| 存储 / 模型 | `Connection` 把 `NameServer`、`EnableACL`、`AccessKey`、`SecretKey` 当成一等字段 | `internal/model/connection.go` |
| 客户端注册表 | 全局单例，按 NameServer 字符串做 key | `rocketmq.GetClientManager()`，`clients map[string]*admin.Client` |
| service 端口 | 唯一现成的缝本身就是 RocketMQ 形状的 | `internal/service/connection/runtime.go` 中的 `clientRuntime.Connect(nameServer, timeout, enableACL, accessKey, secretKey)` |
| bridge | 一个 RocketMQ 名词一个 service，脱敏逻辑写死两个 ACL key | `internal/bridge/*.go`，`ConnectionView.AccessKeyConfigured` |
| 渲染层 | 导航、gating、列和 763 个 i18n key 全部假定 RocketMQ 词汇 | `Sidebar.GROUPS`、`App.tsx` 的 `disabledIds`、`TopicsPage`（95 处 broker 专属引用） |

当前设计里有两条承重的隐性前提，很容易被忽略：

- **同时只能有一个连接在线。** `connectRuntimeLocked` 会把其他所有配置标记为
  离线并移除其客户端，因此下游所有 service 调用 `GetDefaultClient()` 时都不带
  连接参数。
- **能力被假定为全集。** 每个页面都假定每个操作都存在，没有任何办法表达
  「这个 broker 列不出 topic」。

第二条前提在 RocketMQ *内部* 就已经不成立：5.x Proxy 端点只暴露数据面，topic
列表、集群拓扑和 ACL 永远走不通。所以能力（capability）模型不是为 Kafka 做的
前瞻性设计，而是**诚实描述我们已经声称支持的 broker 所必需的**。

## 2. 概念映射表

整个设计由这六种形态分歧有多严重来驱动。这张表是下面所有决策要回答的约束。

| 概念 | RocketMQ | Kafka | RabbitMQ | Pulsar | Redis Stream | MQTT |
| --- | --- | --- | --- | --- | --- | --- |
| 端点 | NameServer 列表 | bootstrap servers | AMQP URI + HTTP 管理接口 | service URL + admin URL | host:port + db | broker host |
| 命名空间 | cluster | cluster | vhost | tenant / namespace | db index | 无 |
| 投递目标 | Topic | Topic | Queue（+ Exchange） | Topic | Stream key | Topic（无注册表，只在有消息经过时存在） |
| 分区 | MessageQueue | Partition | 无 | Partition | 无 | 无 |
| 订阅方 | ConsumerGroup | ConsumerGroup | Queue consumer | Subscription | Group | Session |
| 消费进度 | consumer offset | offset | ack / unacked | cursor | last-delivered-id | 无 |
| 积压 | diff | lag | ready + unacked | backlog | XPENDING | 无 |
| 重试 / 死信 | `%RETRY%` / `%DLQ%` | 应用层自理 | 死信交换机 | 重试 / 死信 topic | XPENDING + XCLAIM | 无 |
| 历史回溯 | 按 offset 拉取 | 从 offset fetch | `basic.get`（破坏性） | Reader API | XRANGE | 不可能 |
| 管理面 | Admin API | AdminClient | HTTP 管理插件 | Admin REST | Redis 命令 | 协议无；$SYS 与厂商 REST 在连接时探测 |

要竖着读列，而不是横着读行：

- **Kafka** 与 RocketMQ 几乎完全重叠。名词相同，叫法不同。
- **Pulsar** 重叠度也很高，但多了一层强制的 tenant/namespace 维度，导致目标的
  标识不能再是一个扁平字符串。
- **RabbitMQ** 分歧严重。没有 offset，默认的浏览方式是破坏性的，而 exchange 和
  binding 是一等对象，别处没有任何对应物。
- **Redis Stream** 有消费组和 pending 条目，但没有集群拓扑，也没有按目标划分的
  权限。
- **MQTT** 协议本身没有管理面：无法枚举主题、没有历史、没有消费组。已实现，且实现方式是在连接时按三层探测——协议本身、多数 broker 会发布的 $SYS 树、以及 EMQX 等自带的 REST API。主题列的是持有保留消息的那些，因为那是唯一能枚举的东西；探测不到的那层带原因上报。

由此得出两个结论，而它们的方向恰好相反：

1. **单一共享页面集 + 纯特性开关**行不通。RabbitMQ 需要一个 Exchange/Binding
   页面，别的形态没有任何对应物；而 MQTT 会渲染成一堆禁用页面的空壳。
2. **六套独立页面集**同样行不通。RocketMQ、Kafka 和 Pulsar 会把大约八千行几乎
   相同的表格、筛选、详情和消息查看代码重复三遍。

架构必须同时在这两个方向上都能伸缩。

## 3. 推荐的页面组织方式

> **共享外壳、规范页面、驱动覆写。**
> 规范页面是驱动复用并扩展的默认实现。驱动可以整页替换，但必须先够格。

三层，并配一条关于什么该放在哪里的硬性规则。

**第一层 —— 外壳。永远共享，永不感知驱动。**
标题栏、侧边栏骨架、连接列表、设置、页面布局与转场、所有 `components/ui/*`
基础组件、toast、告警渲染。它们永远不需要知道什么是 broker。

**第二层 —— 规范页面。默认共享，按能力 gating。**
`Destinations`、`Subscriptions`、`Messages`、`Publish`、`Cluster`、`Access`。
每个页面基于中立领域模型渲染，列和详情字段来自当前驱动，驱动未声明的控件一律
不出现。

**第三层 —— 驱动模块。可选接入，注册制。**
每个驱动贡献术语、连接表单 schema、列集合、详情面板、额外导航项，以及 —— 仅在
确有必要时 —— 整页替换。

防止第三层变成垃圾场的规则：

> 驱动只有在该页面对这个形态**没有对应概念**，或其主表格**一半以上的列**是驱动
> 专属时，才允许整页覆写。否则只能向规范页面贡献列、字段和操作。

套用到六个目标上：

| 形态 | 复用的规范页面 | 有正当理由的覆写 |
| --- | --- | --- |
| RocketMQ | 全部六个 | 无 |
| Kafka | 全部六个 | Cluster 通过列扩展出 controller/ISR 视图；另加一个 Quotas 页与一个 Access 页 |
| Pulsar | 全部六个 | 无（namespace 做成范围选择器，而不是一个页面） |
| RabbitMQ | Messages、Publish、Cluster | Destinations 换成 Queues，外加一个新的 Exchanges/Bindings 页 |
| Redis Stream | Destinations、Subscriptions、Messages、Publish | Cluster 和 Access 按能力隐藏 |
| MQTT | Publish、Subscribe（实时流）、Topics（保留消息）、Clients、Cluster、Overview | 消费组、消息查询、DLQ、ACL 全部隐藏；Clients 与 Cluster 在没有管理 API 时以「已降级 + 原因」呈现 |

只有这一种组织方式能做到：加 Kafka 几乎零成本，*同时*加 MQTT 不会留下一堆禁用
导航的残骸。

Kafka 接完之后，这张表里「无覆写」那一格被推翻了：配额挂在调用方（用户 / 应用 /
IP）而不是挂在目的地上，规范页面里没有任何一个能表达它，所以它必须是一个 Kafka
自己的页面。这不影响上面的主张 —— 六个规范页面确实全部复用了 —— 但「一个形态需要
零个专属页面」这句话说得太满：真正成立的是「专属页面只用来放规范模型说不出的东西」。

### 三页地板

当某个驱动几乎什么都不声明时，应用仍然必须是自洽的。对 MQTT 来说导航就是
连接、发布、订阅、设置 —— 而这必须看起来是有意为之，而不是坏掉了。具体来说，
这否定了 `App.tsx` 当前的做法：禁用导航集是一个写死的 RocketMQ 页面 id 数组。
导航要变成派生状态：输入能力，输出导航。

## 4. 后端设计

### 4.1 包结构

```text
internal/
  driver/                 端口：接口、能力与描述符类型
    registry.go           kind -> Factory
    rocketmq/             今天的 internal/rocketmq，迁移并适配
    kafka/
    rabbitmq/
    pulsar/
  model/                  规范领域模型
  service/                编排层，改为驱动无关
  bridge/                 位置不变，改说规范模型
```

`internal/rocketmq` 迁移到 `internal/driver/rocketmq`，并新增一个实现端口的
适配器。它的内部实现 —— `AdminClientManager`、请求管道 —— 原样保留。

### 4.2 端口

```go
// Driver is one broker family.
type Driver interface {
	Kind() model.MQKind
	// Descriptor is static: connection form schema plus the capabilities the
	// family can support at best. Available with no live connection.
	Descriptor() model.DriverDescriptor
	Open(ctx context.Context, profile model.ConnectionProfile) (Conn, error)
}

// Conn is one live connection to one broker.
type Conn interface {
	Ping(ctx context.Context) error
	Close() error
	// Capabilities may narrow the descriptor once the endpoint has answered:
	// a RocketMQ Proxy endpoint reports far less than a NameServer endpoint.
	Capabilities() model.Capabilities
}
```

可选能力面做成独立接口，通过类型断言发现，而不是返回 nil 的方法：

```go
type DestinationAdmin interface {
	List(ctx context.Context) ([]model.Destination, error)
	Detail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error)
	Create(ctx context.Context, spec model.DestinationSpec) error
	Update(ctx context.Context, spec model.DestinationSpec) error
	Remove(ctx context.Context, ref model.DestinationRef) error
}

type SubscriptionAdmin interface { /* List, Detail, Create, Remove */ }
type ProgressAdmin     interface { /* Lag, ResetOffset — Kafka/RocketMQ/Pulsar/Redis */ }
type MessageReader     interface { /* Query, ByID, Track */ }
type MessagePublisher  interface { /* Send, Resend */ }
type ClusterAdmin      interface { /* Nodes, Summary, NodeDetail */ }
type AccessAdmin       interface { /* ACL and equivalents */ }
type RoutingAdmin      interface { /* RabbitMQ exchanges and bindings */ }
```

Go 代码基于接口来 gating，UI 基于 `Capabilities` 来 gating。两者绝不能漂移，
因此驱动一致性测试要断言：驱动声明的每一项能力都有对应的接口实现，反之亦然。

### 4.3 能力

能力是一个扁平、显式的集合 —— 不是版本号，也不是自由格式的 map —— 这样两侧都能
穷尽地 switch。

```go
type Capability string

const (
	CapDestinationList   Capability = "destination.list"
	CapDestinationCreate Capability = "destination.create"
	CapDestinationDelete Capability = "destination.delete"
	CapPartitions        Capability = "destination.partitions"
	CapSubscriptionList  Capability = "subscription.list"
	CapSubscriptionLag   Capability = "subscription.lag"
	CapOffsetReset       Capability = "subscription.resetOffset"
	CapMessageQuery      Capability = "message.query"
	CapMessageByID       Capability = "message.byId"
	CapMessageTrack      Capability = "message.track"
	CapMessageResend     Capability = "message.resend"
	CapMessageLiveTail   Capability = "message.liveTail"
	CapDLQ               Capability = "message.dlq"
	CapPublish           Capability = "message.publish"
	CapClusterTopology   Capability = "cluster.topology"
	CapClusterMetrics    Capability = "cluster.metrics"
	CapAccessControl     Capability = "access.control"
	CapRouting           Capability = "routing.exchanges"
)

type Capabilities struct {
	Supported []Capability      `json:"supported"`
	// Degraded explains a capability the family has but this endpoint lacks,
	// so the UI can say why instead of silently hiding a control.
	Degraded  map[Capability]string `json:"degraded"`
}
```

`Degraded` 是让 RocketMQ Proxy 连接保持诚实的关键：Topics 页面不是凭空消失，而是
说明该端点只是数据面。

### 4.4 连接配置

```go
type MQKind string

const (
	KindRocketMQ    MQKind = "rocketmq"
	KindKafka       MQKind = "kafka"
	KindRabbitMQ    MQKind = "rabbitmq"
	KindPulsar      MQKind = "pulsar"
	KindRedisStream MQKind = "redis-stream"
	KindMQTT        MQKind = "mqtt"
)

type ConnectionProfile struct {
	ID         int               `json:"id"`
	Name       string            `json:"name"`
	Group      string            `json:"group"`
	Kind       MQKind            `json:"kind"`
	Endpoints  string            `json:"endpoints"`  // driver parses; replaces NameServer
	TimeoutSec int               `json:"timeoutSec"`
	Auth       AuthConfig        `json:"auth"`
	Options    map[string]string `json:"options"`    // non-secret, schema-validated
	Secrets    map[string]string `json:"-"`          // encrypted at rest, never serialised outward
	Status     ConnectionStatus  `json:"status"`
	LastCheck  string            `json:"lastCheck"`
	IsDefault  bool              `json:"isDefault"`
	Remark     string            `json:"remark"`
}

type AuthConfig struct {
	Mechanism string `json:"mechanism"` // "none" | "acl" | "sasl-plain" | "sasl-scram" | "plain" | "token" | "mtls"
}
```

`Options` 和 `Secrets` 是让存储 schema 保持稳定、同时允许驱动新增字段的扩展点。
把两者分开，是为了让加密和脱敏留在同一个地方，而不是每个驱动各自重新实现一遍：
`Secrets` 里的所有内容写入时加密，送往渲染层时替换为一个
`secretsConfigured []string` 列表，这是对今天 `accessKeyConfigured` /
`secretKeyConfigured` 这一对字段的泛化。

### 4.5 由驱动声明的连接表单

连接表单是每接入一个新形态都必然要碰的唯一界面。把它声明成数据，意味着加
Redis Stream 只需要改后端：

```go
type FieldType string // "text" | "password" | "number" | "select" | "switch" | "endpoint-list"

type FormField struct {
	Key         string      `json:"key"`         // writes into Endpoints, Options or Secrets
	Type        FieldType   `json:"type"`
	LabelKey    string      `json:"labelKey"`    // i18n key, not a literal
	Placeholder string      `json:"placeholder"`
	Default     string      `json:"default"`
	Required    bool        `json:"required"`
	VisibleWhen *FieldCond  `json:"visibleWhen"` // e.g. auth.mechanism == "sasl-scram"
	Options     []FormOption `json:"options"`
	Validate    string      `json:"validate"`    // named validator: "host-port", "url", "int-range"
}

type DriverDescriptor struct {
	Kind        MQKind       `json:"kind"`
	LabelKey    string       `json:"labelKey"`
	Terms       Terms        `json:"terms"`
	MaxCapabilities []Capability `json:"maxCapabilities"`
	Form        []FormField  `json:"form"`
	DefaultPort string       `json:"defaultPort"`
}
```

校验器保持为一个具名的封闭集合，在前端解析 —— 把正则表达式跨 bridge 传输，等于
把校验逻辑从代码评审挪进了数据里。逃生舱依然保留：驱动模块可以注册自定义表单
组件，通用渲染器就此让位。

### 4.6 运行时注册表

按 NameServer 做 key 的全局 `map[string]*admin.Client`，改为按连接 ID 做 key 的
注册表：

```go
type Registry interface {
	Open(ctx context.Context, profile model.ConnectionProfile) error
	Get(id int) (driver.Conn, bool)
	Active() (driver.Conn, bool)
	SetActive(id int) error
	Close(id int)
	CloseAll()
}
```

改成按 ID 而不是按端点字符串做 key，是这里真正要紧的改动。两个配置完全可能在
不同形态下共用同一个地址。

### 4.7 多连接：把契约层和 UI 层分开决定

「同时支持多个不同的 MQ」有三个层次，代价完全不同，必须分开表态。

| 层次 | 含义 | 状态 |
| --- | --- | --- |
| A 多配置、单活跃 | 保存多个配置，同一时刻只有一个在线 | 今天的行为 |
| B 多连接同时在线、UI 单焦点 | 多个连接常驻，页面作用于「当前」连接，切换即时；后台采集同时覆盖全部 | **契约层现在就要做对** |
| C 跨 MQ 聚合视图 | 一个页面同时呈现多个 broker：聚合总览、跨 broker 检索、迁移工具 | 产品功能，可在 B 之上叠加 |

**B 的唯一真正阻塞点是：现在没有任何一个 bridge 方法携带连接标识。**
`TopicService.List()`、`ClusterService.Brokers()`、`MessageService.Query(...)`
全部隐式操作「默认客户端」。除此之外还有两处把「默认连接」焊死了：

- `mqexec.Do` 在重连时直接向全局要 `GetDefaultConnection()`，重试语义绑定在
  默认连接而不是发起调用的那个连接上。
- `collector` 把 `hasClient` 绑定到 `HasActiveDefaultClient`，因此后台采样天然
  只覆盖一个连接。

要打开 B，需要改的是：约 30 个 bridge 方法各加一个连接 ID 参数、重试改为
per-`Conn`、采集器循环采样 N 个连接、`connectRuntimeLocked` 不再强制把其他连接
下线。

**范围决定（修正）。** 契约层按 B 设计，从阶段 0 就把连接 ID 放进签名；UI 层
v1 仍然单焦点，一次只呈现一个连接。理由是两者的成本曲线相反：

> bridge 签名变更要同时改动 Go 和 TS 的每一个调用点。现在只有 RocketMQ 一种
> 形态时做，是一次机械替换；等 Kafka 和 RabbitMQ 落地之后再做，调用点是现在的
> 三倍，而且每个驱动都已经围绕「默认连接」写了一遍自己的假设。

反过来，UI 层的多焦点（导航听谁的、Overview 聚合什么）是纯粹的产品问题，推迟
它不会让将来更贵 —— 因为它建立在契约之上，而不是嵌在契约里面。C 同理：它需要
扇出调用的部分失败语义和真正可比的规范模型，但那是加在 B 上面的一层，不需要
回头改 B。

### 4.8 bridge

bridge service 不再是「一个 RocketMQ 名词一个」，而是「一个规范领域一个」，各自
按传入的连接 ID 取出 `Conn` 并返回规范模型：

| 今天 | 之后 |
| --- | --- |
| `TopicService` | `DestinationService` |
| `ConsumerService` | `SubscriptionService` |
| `MessageService` | `MessageService`（名字不变，载荷改为规范模型） |
| `ClusterService` | `ClusterService` |
| `ACLService` | `AccessService` |
| — | `DriverService` —— `List()`、`Descriptor(kind)`、`Capabilities()` |

`DriverService` 是新增的，也是渲染层启动时要读的第一个东西。

设置需要拆分一处：`GlobalAccessKey` / `GlobalSecretKey` 是坐在全局设置里的
RocketMQ ACL 概念。它们改为按形态划分的默认值
（`defaults: map[MQKind]map[string]string`），现有值迁移到 `rocketmq` 下。

## 5. 前端设计

### 5.1 结构

```text
frontend/src/
  api/            binding 包装层，改为规范模型（位置不变）
  mq/             新增
    types.ts         规范 UI 类型
    registry.ts      kind -> MqModule，以 RocketMQ 模块作为参考实现
    capabilities.ts  useCapabilities()、<Capable of="..."> 门控组件
    terms.ts         术语解析
    form.ts          schema 驱动的连接表单渲染器
    rocketmq/        列、详情面板、额外导航
    kafka/
    rabbitmq/        含 Exchanges/Bindings 页面
  pages/          规范页面
  components/     不变，驱动无关
```

```ts
export interface MqModule {
  kind: MQKind
  /** Columns and detail fields contributed to canonical pages. */
  destinations?: PageContribution<Destination>
  subscriptions?: PageContribution<Subscription>
  /** Whole-page replacements. Must satisfy the override rule in section 3. */
  pages?: Partial<Record<CanonicalPageId, ComponentType<PageProps>>>
  /** Extra nav entries beyond the canonical set. */
  nav?: NavContribution[]
  /** Optional custom connection form; the schema renderer is the default. */
  connectionForm?: ComponentType<ConnectionFormProps>
}
```

### 5.2 能力门控

```tsx
const caps = useCapabilities()

<Capable of="subscription.resetOffset">
  <Button onClick={resetOffset}>{t(term('action.resetOffset'))}</Button>
</Capable>
```

`<Capable>` 在不支持时什么都不渲染，在该能力出现于 `Degraded` 中时渲染一个带
说明的禁用态。**静默缺席**和**有说明的缺席**是两种不同状态，组件必须区分它们，
否则一个 Proxy 连接看起来就像是个 bug。

### 5.3 术语

把 RabbitMQ 的 queue 叫成「Topic」是错的；把 Kafka 的 topic 叫成「投递目标」又
太官僚。每个驱动声明自己的术语，UI 通过它们解析标签：

```text
mq.common.terms.destination    = "Destination"     // 兜底
mq.rocketmq.terms.destination  = "Topic"
mq.kafka.terms.destination     = "Topic"
mq.rabbitmq.terms.destination  = "Queue"
mq.redis-stream.terms.destination = "Stream"
```

```ts
const term = useTerms()   // 按当前形态解析，回落到 common
t(term('destination.plural'))
```

现有 763 个 key 大部分原地不动。只有真正 RocketMQ 专属的那些 —— 队列权限、
延迟等级、`%RETRY%` 处理 —— 迁移到 `mq.rocketmq.*` 下。

### 5.4 导航

`Sidebar.GROUPS` 不再是常量。导航由「规范页面集按能力过滤」加上「当前模块的
`nav` 贡献」计算得出，`App.tsx` 里写死的 `disabledIds` 数组随之删除。没有 active
连接时，外壳只显示连接和设置 —— 这正是现在 `gated` 分支已经近似做到的事。

## 6. 复用边界：哪些业务逻辑跨 MQ 共享

上面的分层只有在「共享的那部分确实够大」时才划算。下面的后端数字是实测的
（按是否 import `internal/rocketmq` 或 `rocketmq-admin-go` 统计，不含测试文件），
前端的规范页面占比是估计，已标注。

### 6.1 后端：约 40% 已经是驱动无关的

| 类别 | 文件数 | 行数 | 去向 |
| --- | --- | --- | --- |
| 驱动耦合 | 27 | 3,229 | 迁入 `driver/rocketmq/` |
| `internal/rocketmq` 本体 | 1 | 329 | 迁入 `driver/rocketmq/` |
| 未耦合但仍是 RocketMQ 形状 | 4 | 167 | 迁入 `driver/rocketmq/` |
| **真正跨 MQ 共享** | **31** | **约 2,482** | **留在 `service/`** |

那 167 行值得单独点名，因为它们不 import 客户端库，容易被误判为可复用：
`topic/parser.go` 解析 RocketMQ 的 MessageQueue JSON、`message/matching.go` 匹配
MessageQueue key、`consumer/validation.go` 校验 CLUSTERING/BROADCASTING 枚举、
`connection/validation.go` 校验 NameServer 地址格式。**判定复用边界要看语义，
不能只看 import。**

留下的约 2,482 行是名副其实的业务逻辑，与 broker 形态无关：

- 连接配置的持久化、生命周期状态机、增删改、重载（约 570 行）
- 配置导入 / 导出 / 编解码 / 维护（约 380 行）
- 设置的持久化、归一化、变更（约 230 行）
- TPS 时序历史与聚合（约 270 行）—— 它存的只是带时间戳的数字
- 本地加密、原子写、目录布局、更新检查、系统资源采样（约 520 行）

告警规则同理：lag 与磁盘阈值的判定逻辑本身只是数值比较，跨形态可用；形态之间
的差异只体现在「这个 broker 是否提供这个指标」，而那正好由能力集回答。

### 6.2 前端：约 32% 天然无关，但真正的杠杆在规范页面

实测（不含测试文件）：驱动无关的约 4,116 行 —— `components/` 与
`components/ui/`（1,802）、`lib/`（783）、`layout/`（469）、i18n 与样式（47），
以及无关的 hooks（`useSettings`、`useAlerts`、`useConnections`、`useUpdateCheck`、
`useUIPrefs`、`useRecentPicks`、`useDelayedUnmount`，合计 1,015）。耦合的约
8,676 行，其中 `pages/` 占 7,825。

但「`pages/` 全是耦合的」这个读法会低估复用度，而这正是本设计的核心主张：

> `pages/` 里的绝大部分是表格、筛选、分页、详情面板、消息查看器的骨架，它们变成
> 第二层的规范页面并被 RocketMQ / Kafka / Pulsar 共享；真正驱动专属的只有列定义、
> 表单字段和少数几个操作。

以 `TopicsPage.tsx` 为例：918 行，其中 broker 专属引用 95 处，集中在列定义、
创建/编辑表单字段和详情面板的几行上。**估计**其中 150–250 行属于驱动贡献，
其余约 700 行是可共享的骨架。这个比例还没有被验证 —— 它要到阶段 4 才第一次
接受检验，届时如果 Kafka 的 Destinations 页需要改动的骨架远超预期，说明规范
页面的抽象层次定错了。

### 6.3 业务场景的复用，不只是代码的复用

规范模型真正的回报不在行数，而在于：**一段针对规范模型写的流程，能在任何声明了
所需能力的驱动上跑。** 这让下面这些成为可能，而且不需要为每种形态各写一遍：

- 同一套告警规则同时作用于 RocketMQ 和 Kafka
- 同一个「查消息 → 看轨迹 → 重发」的操作路径在不同形态下是同一段代码
- 跨形态迁移工具：从驱动 A 读出规范消息，再向驱动 B 发布 —— 这是第 4.7 节 C
  层次的典型场景，它之所以可行，前提正是 `Message` 是规范模型而不是
  RocketMQ 结构体

代价也要说清楚：规范模型必然是各形态的**交集加可选扩展**，因此每个驱动都会有
一些能力表达不了、只能靠 `Options` 或驱动专属页面承载的细节。这是刻意的取舍 ——
交集负责复用，扩展点负责保真。

## 7. 存储迁移

`connections.json` 新增 `kind`、`endpoints`、`auth`、`options`、`secrets`。
加载时一次性迁移，无需用户操作：

- 没有 `kind` 的记录变成 `"rocketmq"`。
- `nameServer` 迁到 `endpoints`。
- `enableACL` 为 true 时变成 `auth.mechanism = "acl"`，否则 `"none"`。
- `accessKey` / `secretKey` 以同名迁入 `secrets`，保留现有的 `ENC:` 值，因此
  无需重新加密，用户也不必重新输入。

文件新增 `schemaVersion`，这样下一次改动不必再靠「字段缺失」来推断结构。设置里
那两个全局 ACL key 用同样方式迁移。

## 8. 迁移计划

每个阶段都可独立发布，阶段 0 到 3 对用户必须完全无感。

| 阶段 | 范围 | 完成判据 |
| --- | --- | --- |
| 0 | 仅契约：`MQKind`、`Capability`、`Capabilities`、`DriverDescriptor`、`ConnectionProfile`。无行为变更。 | 类型编译通过，RocketMQ 声明全部能力 |
| 1 | 后端端口：抽出 `internal/driver`，把 RocketMQ 包成第一个驱动，用按 ID 的注册表替换全局单例，service 改为接收 `Conn`；`mqexec` 重试改为 per-`Conn`，采集器按连接循环 | 现有测试原样通过，且代码中不再有任何「默认连接」的隐式读取 |
| 2 | 存储与 bridge：配置迁移、泛化脱敏、`DriverService`、规范 bridge service；**每个 bridge 方法加上连接 ID 参数** | 现有配置无需用户操作即可加载并连接 |
| 3 | 前端接缝：`mq/` 注册表、能力门控、术语解析、schema 驱动表单、派生导航 | 对 RocketMQ 而言逐屏与今天完全一致 |
| 4 | **RabbitMQ 驱动**（已与 5 对调） | Exchanges/Bindings 页面存在，且没有 offset 概念泄漏进 UI |
| 5 | Kafka 驱动 | topic、消费组、lag、浏览、发布端到端可用 |
| 6 | Pulsar，然后 Redis Stream，然后 NATS，然后 MQTT | 每个都是纯增量：不改动任何规范页面 |
| 7 | ActiveMQ / Artemis，然后 NSQ | 仍是纯增量；ActiveMQ 用来检验 JMS 语义能否套进规范页面 |
| 8 | 云托管：SQS、Google Pub/Sub、Azure Service Bus、Kinesis；然后 IBM MQ 与 Solace | 连接表单能表达「无地址，只有 region 与凭证」这一形态 |

> **阶段 4 与 5 已对调。** 原顺序把 Kafka 放在前面是按「由易到难」排的，但下面
> 的排期提示一恰好说明这是错的：Kafka 验证不了抽象。查证后还发现 RabbitMQ 的
> 驱动实现并不更重（纯 REST 管理面 + `rabbit-hole` 成熟客户端，队列深度与速率
> 一次调用即得），所以「先易后难」这个理由本身也不成立。详见
> [MULTI_MQ_REFACTOR_PLAN.md](MULTI_MQ_REFACTOR_PLAN.md) 第 7 节。

**排期提示一：真正的验证必须是第二个驱动，不能推迟。** Kafka 与 RocketMQ 足够
接近，即使抽象是错的，它也会顺利跑通 —— 这正是上面把 RabbitMQ 提到阶段 4 的
理由。在确定阶段 3 的页面契约之前，仍然先在纸上把 RabbitMQ 的 Queues 页和 MQTT
的导航套进去比一遍：如果其中任何一个要求规范页面改变形状，那个改动在阶段 3 做，
远比在阶段 4 做便宜。

**排期提示二：连接 ID 必须在阶段 2 进入签名，不能推迟。** 它是第 4.7 节 B 层次
唯一的阻塞点，而它的成本曲线是单调上升的：现在只有 RocketMQ 一种形态，这是一次
机械替换；等到第二个驱动落地之后再补，调用点是现在的三倍，且每个驱动都已围绕
「默认连接」写好了自己的假设。UI 是否真的同时展示多个连接可以之后再定 ——
但**契约里必须先有那个参数**。

**排期提示三：云托管这一档的风险不在驱动，在连接表单。** 阶段 8 之前的九种形态
都是「地址 + 可选凭证」，schema 驱动表单只需换字段标签；云托管是「region + 凭证，
没有地址」，是第一次出现 `Endpoints` 为空却仍然合法的连接。表单与校验能否表达这
一点，应该在阶段 3 定页面契约时就在纸上比一遍 —— 理由与提示一相同：形状改动放
在阶段 3 远比放在阶段 8 便宜。

## 9. P5 的检验结果

RabbitMQ 驱动落地后，这套抽象的实际表现如下。**结论是它基本成立，但有一处必须
改。**

### 9.1 成立的部分

| 设计 | RabbitMQ 的检验 |
| --- | --- |
| 能力门控 | 七项能力**不声明**：offset 重置、分区、按 ID 查消息、消息轨迹、目标更新、订阅创建/删除。UI 因此不渲染这些控件，测试断言了它们的缺席 |
| 三态能力 | 浏览是「支持但有警告」的真实用例：它能用，但会改变队列状态，所以带 caveat 而不是静默执行 |
| 规范页面 | **一个规范页面都没有被迫改形状**。只有 Exchanges/Bindings 需要整页覆写，符合覆写规则 |
| 属性扩展点 | 队列的 durable/type/state、节点的 Erlang 进程数等都装得下 |
| 未知哨兵 | RabbitMQ 没有分区、交换机没有深度、集群没有磁盘百分比 —— 三处都靠 `UnknownMetric` 表达「不适用」而不是 0 |

一个意外的重合：**RabbitMQ 把两个规范名词坍缩到了同一个对象上。** 它没有具名
消费组，消费者是通道级的临时注册，真正承载积压和消费者集合的是队列本身。所以
「订阅方」在这里就是「从消费侧看的队列」。规范模型没有因此变形。

### 9.2 必须改的一处：AccessAdmin

`AccessAdmin` 端口是照 RocketMQ ACL 的形状定的，RabbitMQ 装不进去：

| 端口方法 | RabbitMQ |
| --- | --- |
| `AccessEnabled` | 恒为真，用户体系总在 |
| `AccessVersion` | **无对应** |
| `PutAccessConfig`（AccessKey + topic/group 权限列表） | 用户 + 按 vhost 的 configure/write/read 正则，**形状不同** |
| `RemoveAccessConfig` | 删除用户，勉强对应 |
| `SetGlobalWhiteAddrs` | **无对应** |

五个方法里两个没有对应物、一个形状不匹配。硬接意味着为了满足接口而**凭空发明
三个概念**，所以 RabbitMQ 驱动**不实现也不声明** `access.control`。

这正是计划里写的失败信号之一（「某个概念既塞不进 Options 也塞不进驱动贡献」）。
现在有了第二个真实实现作为依据，规范的访问控制模型该按「主体 + 按命名空间的
权限规则」重新设计，而不是按一家的 ACL 形状。

### 9.3 顺带发现的一个真实缺陷

RabbitMQ 在消息没有属性时返回 `[]` 而不是 `{}`（Erlang 把空 map 编码成空列表），
直接解进 map 会在**最常见的路径**上失败。这个 bug 类型系统抓不到，只有对着真实
broker 跑才会暴露 —— 也是把驱动测试指向 docker 环境而不是 mock 的理由。

### 9.4 全量管理面接完之后的补充结论

上面的 9.1–9.3 是只有六个端口时得出的。把 RabbitMQ 的管理面做完之后（虚拟主机、
用户与权限、策略与参数、定义、Shovel 与 Federation、连接与信道、健康检查、stream
队列），有几条需要补上。

**规范端口不够用时新建专属端口，是对的。** 这一轮新增的十四个端口里，只有
`RoutingMutator` 和 `QueueActions` 勉强算通用；其余全部是 RabbitMQ 形状的，
硬塞进规范词汇表只会让规范词汇表变成 RabbitMQ 的同义词。判据反过来更好用：
**一处复用如果导致某个家族少一个字段、少一个操作，或者把「这里没有这个概念」
渲染成 `—`，那就不复用。**

**能力的第三态在插件上真正用起来了。** Shovel、Federation 和 stream 协议都是
插件。装了就是 supported，没装就是 degraded 并带原因 key，而不是 absent ——
absent 会让一个装个插件就能用的功能看起来像没做。这里踩到一个真实的坑：探测
必须问**插件自己的端点**。Shovel 的定义存在 runtime parameter 里，而参数存储
是核心功能，所以 `/api/parameters/shovel` 在完全没有 shovel 插件的 broker 上
也回 200 —— 能力因此一直是 supported，页面打开就报错。只有 `/api/shovels` 才
会 404。

**「测不出来的降级路径等于没有降级路径」。** 上面这个 bug 是靠新加的
`tests/e2e/rabbitmq-plain` 抓出来的：一个不装任何可选插件的 broker。主环境为了
让页面有东西可读把插件全打开了，所以它永远测不到 404。

**告警规则必须按家族分派（对应 §10 第 2 条）。** 原来一套规则读的是 RocketMQ 的
属性键 —— broker 序号、消费组积压、commitlog 磁盘占比。RabbitMQ 一个都不上报，
于是每条规则都读到 0，**一条告警都不会触发**，而侧栏还照常显示告警页。这不是
「规则不适用」，是静默失效。现在规则跟着家族走：RabbitMQ 用它自己的资源告警
（内存/磁盘水位线一旦越过，节点就已经拒绝生产了）、网络分区、队列堆积、无人
消费、连接被限流。

**消息标识（§10 第 3 条）已有实测依据。** RabbitMQ 确实没有稳定 id：浏览用
`basic.get` + `nack(requeue)`，读到的消息会带上 redelivered 标记回队列，
delivery tag 只在那个信道那次投递里有效。所以 Messages 页面不能假定 id 可展示，
也不能假定「同一条消息」能被第二次定位到 —— 这一轮把它当作事实接受了（浏览带
caveat），而不是伪造一个 id。

## 10. 待定决策

这几项需要在阶段 3 之前有答案，而不是阶段 0 之前。

1. **Overview 页面。** 它目前聚合 RocketMQ 集群健康度。对 MQTT 来说没有任何东西
   可聚合。可选：做成一个能坍缩为连接摘要的规范页面，或者移进驱动贡献里。
2. **告警。** lag 和磁盘阈值是 RocketMQ 形状的。告警规则是按形态划分，还是保持
   固定集合并按能力门控。
3. **消息标识。** RocketMQ 有 msgId，Kafka 是 topic/partition/offset，RabbitMQ
   根本没有稳定 id。规范的 `Message` 需要一个由驱动铸造的不透明 `ref`，而且
   Messages 页面不能假定它可展示。
4. **目标标识。** Pulsar 的 tenant/namespace/topic 意味着 `DestinationRef` 不能
   是字符串。提案：一个带 `namespace` 和 `name` 的结构体，扁平形态把
   `namespace` 留空。
5. **实时 tail。** MQTT 和 Redis Stream 是订阅形状而非查询形状的，这需要一条
   从 Go 到渲染层的流式通道，而当前的请求/响应式 bridge 并不具备。
