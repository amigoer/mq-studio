# 多 MQ 重构实施文档

本文是 [MULTI_MQ_REFACTOR_PLAN.md](MULTI_MQ_REFACTOR_PLAN.md) 的落地版本：计划
回答「动哪些文件」，本文回答「按什么顺序提交、每个提交里具体写什么、怎么确认
没写坏」。

- **分支**：`refactor/multi-mq-driver`（已创建，本地）
- **范围**：P0–P5，终点是**接入 RabbitMQ 并验证抽象成立**
- **状态**：待确认，尚未写代码

## 0. 为什么第二个驱动选 RabbitMQ 而不是 Kafka

「哪个简单」和「哪个能验证架构」指向相反的选项：**Kafka 简单恰恰是因为它与
RocketMQ 结构同构，而那正是它验证不了抽象的原因。** 抽象即使定错了，Kafka 也会
顺利跑通。

查证之后还有一个反直觉的结论：**RabbitMQ 的驱动实现工作量并不比 Kafka 大，甚至
更小。**

| | Kafka | RabbitMQ |
| --- | --- | --- |
| 管理面协议 | 二进制协议 | 纯 REST / JSON |
| Go 客户端 | `twmb/franz-go` + `pkg/kadm` | `michaelklishin/rabbit-hole/v2`（2013 年至今，成熟） |
| 列表页数据 | Metadata + ListOffsets + OffsetFetch 多次往返 | `GET /api/queues` **一次调用**返回 `messages_ready`、`messages_unacknowledged`、`consumers`、`message_stats` 速率 |
| 积压计算 | `kadm.Lag` 已封装，不必手写 | 直接是队列字段，无需计算 |
| 前置条件 | 无 | **需要启用 management 插件** |
| 驱动工作量 | 中等 | **更小** |
| 前端改动 | 几乎为零，全部复用 | 新增 Exchanges/Bindings 页 + 能力门控路径 |
| **验证价值** | **低** —— 结构同构，抽象错了也跑得通 | **高** —— 无 offset、无分区、破坏性浏览、需要整页覆写 |

RabbitMQ 的额外成本全在前端，而**那部分额外成本正是这次验证本身**：它会逼着
能力门控、术语解析、整页覆写规则三条设计各走一遍真实路径。Kafka 一条都走不到。

一处对设计文档的**佐证**：RabbitMQ 官方文档对
`POST /api/queues/{vhost}/{name}/get` 的原话是「这不是 HTTP GET，因为它会改变
队列状态」。即使用 `ackmode=reject_requeue_true` 重新入队，`redelivered` 标记
和消息位置也会变。所以设计文档里「破坏性浏览」的说法成立，UI 必须为此给出提示 ——
这正是规范 Messages 页无法直接套用的地方。

## 1. 读代码之后的三条设计细化

写实施文档时通读了服务层的取客户端方式，有三处必须在动手前定下来。其中第三条
是对计划的**修正**。

### 1.1 超时改由 context 携带，驱动不依赖 Settings

现状是每个服务方法自己取超时：

```go
client, err := rocketmq.GetClientManager().GetDefaultClient()
err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
	// ...
})
```

如果这段原样搬进驱动，**每个驱动都要持有一份 Settings**，等于把应用设置耦合进
了每一个 broker 适配器。

改为：薄编排层在调用驱动之前 `context.WithTimeout`，驱动方法只接 `ctx` 并遵守
它的 deadline。驱动对 Settings 零依赖。

`GetFetchLimit()` 同理 —— 它是查询参数，显式放进查询结构体，不走 Settings。

### 1.2 `service/` 保留一层薄编排，不让 bridge 直接调驱动

薄编排层负责五件事，都不是驱动的职责，也不该在每个 bridge 方法里重复一遍：

| 职责 | 说明 |
| --- | --- |
| 按连接 ID 从注册表取 `Conn` | 连接不存在 / 未打开的统一处理 |
| 能力检查 | 类型断言可选接口，不支持时返回带 `Capability` 的类型化错误 |
| 应用超时 | 见 1.1 |
| 分配列表 ID | `TopicItem.ID` 等是 UI 列表键，不是 broker 数据 |
| 错误归一化 | 驱动错误包装成统一形状 |

包名跟随规范名词：`service/destination/`、`service/subscription/`、
`service/access/`；`service/message/`、`service/cluster/` 保留原名但只剩薄编排。

```go
// service/destination/service.go
type Service struct {
	registry driver.Registry
	settings Settings
	nextID   int64
}

func (s *Service) List(ctx context.Context, connID int) ([]*model.Destination, error) {
	api, err := s.destinationAdmin(connID)   // registry lookup + capability assert
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.settings.GetRequestTimeout())
	defer cancel()
	items, err := api.List(ctx)
	// ... assign list IDs, normalise error
}
```

### 1.3 修正：计划里「整包移动，内部实现不改」说得太满

要移动的文件里有两处对 `Service` 自身状态的引用，必须在移动前先摘出来：

| 引用 | 处理 |
| --- | --- |
| `s.settings.GetRequestTimeout()` | 提到薄编排层，改由 ctx 携带（1.1） |
| `s.getNextID()` | 留在薄编排层 —— 它生成的是 UI 列表键，不是 broker 数据 |

所以准确的说法是**「移动 + 两处机械提取」**，不是纯移动。除这两处外，函数体
不改。

## 2. 必须逐字保留的现有行为

25 处取默认客户端里，**5 处在取不到客户端时吞掉错误、返回空结果**，其余 20 处
向上抛。这个不对称是刻意的：列表页在断连时渲染空列表而不是错误横幅。

| 位置 | 取不到客户端时返回 |
| --- | --- |
| `topic/query.go:37` | `[]*model.TopicItem{}, nil` |
| `topic/query.go:73` | `[]*model.TopicItem{}, nil` |
| `topic/query.go:109` | `0, nil` |
| `consumer/query.go:22` | `[]*model.ConsumerGroupItem{}, nil` |
| `cluster/broker.go:135` | `[]*model.NameServerNode{}, nil` |

**薄编排层必须在这 5 个方法上显式保留这一行为**，其余方法照常返回错误。改成
统一抛错会让断连时的界面从空列表变成错误提示 —— 那是用户可见的变化，违反
P0–P3 无感约束。

实现上加一个显式的辅助函数，让这个决定在代码里可见，而不是散落的 `return nil`：

```go
// emptyOnOffline reports whether a missing connection should yield an empty
// result instead of an error. Five list endpoints render empty when offline;
// changing that would surface an error banner where the UI shows nothing today.
```

## 3. 提交清单（30 个提交）

每个提交都必须独立编译、`go test ./...` 通过。提交信息遵循 Conventional
Commits，纯英文。

### P0 — 契约类型（1 个提交）

**提交 1 — `feat(model): add the multi-broker contract types`**

新增 6 个文件：`mqkind.go`、`capability.go`、`descriptor.go`、`profile.go`、
`destination.go`、`subscription.go`。无引用，无行为变更。

### P1 — 后端驱动端口（7 个提交）

因为要求「每步都能编译」，域内的移动必须原子完成：移动操作文件、建适配器、建
薄编排层、改 bridge 指向，这四件事在同一个提交里。拆得更细就会出现编译不过的
中间态。

| # | 提交 | 内容 | 约计改动 |
| --- | --- | --- | --- |
| 2 | `feat(driver): add the driver port and registry` | `driver/{driver,ports,registry,conformance}.go`。新增，无引用 | +400 |
| 3 | `refactor(driver): move the rocketmq client into the driver package` | `internal/rocketmq/` → `internal/driver/rocketmq/`，全仓改 import 路径 | 移动 329 行 |
| 4 | `refactor(destination): route topic operations through the driver port` | 移 `topic/{query,detail,enrich,mutation,stats,parser}.go`；建 `driver/rocketmq` 的 `DestinationAdmin`；建 `service/destination/`；改 `bridge/topic.go` | 约 850 行移动 |
| 5 | `refactor(subscription): route consumer operations through the driver port` | 移 `consumer/{query,broker,enrichment,mutation,validation}.go`；同上三件 | 约 604 行移动 |
| 6 | `refactor(message): route message operations through the driver port` | 移 `message/{query,scan,lookup,tracking,command,retry,conversion,matching}.go` | 约 800 行移动 |
| 7 | `refactor(cluster,access): route cluster and acl operations through the driver port` | 移 `cluster/{broker,overview}.go`、`acl/*`、`internal/mqoffset/` | 约 700 行移动 |
| 8 | `refactor(service): resolve connections through the registry` | 清除三处默认连接隐式读取：`mqexec` 降为驱动内部助手、`collector` 改注入、`connection/lifecycle` 下线改显式策略；`connection/validation.go` 移入驱动 | 约 250 行 |

### P2 — 存储与 bridge（5 个提交）

| # | 提交 | 内容 |
| --- | --- | --- |
| 9 | `feat(storage): migrate connection profiles to the kind-based schema` | `ConnectionProfile`、`schemaVersion`、加载时迁移；`ENC:` 值原样保留 |
| 10 | `refactor(bridge): generalise credential redaction` | `secretsConfigured []string` 取代两个写死的布尔 |
| 11 | `refactor(bridge): pass the connection id into every scoped method` | 29 个方法加参数；20 个不动 |
| 12 | `feat(bridge): expose driver descriptors and capabilities` | 新增 `DriverService` |
| 13 | `chore(bindings): regenerate the typescript bindings` | `wails3 generate bindings`；前端最小改动跟上新签名（只传当前连接 ID），真正的重构留到 P3 |

第 13 个提交是风险点：bindings 重新生成会让前端大面积报错。处理方式是**在这个
提交里只做「让它编译」的最小改动**，不碰页面结构。

### P3 — 前端分层（9 个提交）

| # | 提交 | 内容 |
| --- | --- | --- |
| 14 | `feat(mq): add the driver module registry and capability gate` | `mq/{types,registry,capabilities}.ts` |
| 15 | `feat(mq): resolve terminology through the active driver` | `mq/terms.ts` + `mq.common.terms.*` / `mq.rocketmq.terms.*` |
| 16 | `refactor(connections): render the connection form from the driver schema` | `mq/form.ts` + 具名校验器表；约 120 行 NameServer 解析移入 `mq/rocketmq/` |
| 17 | `refactor(destinations): split TopicsPage into the canonical page` | 918 行拆成规范骨架 + `mq/rocketmq/destinations.tsx` |
| 18 | `refactor(subscriptions): split ConsumersPage into the canonical page` | 904 行 |
| 19 | `refactor(messages): move rocketmq specifics out of MessagesPage` | 789 行 |
| 20 | `refactor(pages): move rocketmq specifics out of cluster, access and publish` | ClusterPage 403 + AclPage 605 + ProducerPage 377 |
| 21 | `refactor(overview): split the summary from the driver metric cards` | 816 行；临时方案，见计划 5.2 |
| 22 | `refactor(nav): derive navigation from capabilities` | 删 `Sidebar.GROUPS` 常量与 `App.tsx` 的 `disabledIds` |

`AlertsPage`、`EmptyStatePage`、`SettingsPage` 不单独立提交 —— 前两个整页可复用
只需换术语键，`SettingsPage` 的按形态默认值段落并入提交 12。

### P4 — 品牌色（1 个提交）

**提交 23 — `feat(theme): split the brand accent from the semantic success colour`**

新增 `--brand` 令牌与 `tailwind.config.js` 的 `brand` 色；21 个消费点按计划
6.2 的表分流。可以随时插入，与 P0–P3 无冲突。

### P5 — RabbitMQ 驱动（7 个提交）

这一阶段的目的不是「多支持一种 MQ」，而是**让抽象第一次接受真实检验**。判据不是
「RabbitMQ 能用」，而是「接它的过程中规范页面没有被迫改形状」。

| # | 提交 | 内容 |
| --- | --- | --- |
| 24 | `test(e2e): add a rabbitmq environment` | `tests/e2e/rabbitmq/`，`rabbitmq:*-management` 镜像。先建环境，后面才能对着真实 broker 开发 |
| 25 | `feat(driver): add the rabbitmq driver skeleton` | `driver/rabbitmq/`：`Conn`、`Descriptor`、能力声明、连接表单 schema。**能力声明里不含 `subscription.resetOffset`、`destination.partitions`、`message.byId`** |
| 26 | `feat(rabbitmq): implement destination and subscription admin` | `GET /api/queues`、`GET /api/consumers`；积压直接取 `messages_ready` + `messages_unacknowledged` |
| 27 | `feat(rabbitmq): implement message browse and publish` | `POST .../get`（`ackmode=reject_requeue_true`）与 `PUT .../publish`；浏览必须带状态变更提示 |
| 28 | `feat(rabbitmq): implement cluster and access admin` | `GET /api/nodes`、`/api/overview`、`/api/users`、`/api/permissions` |
| 29 | `feat(mq): add the rabbitmq frontend module` | 术语（Queue 而非 Topic）、列集合、表单 schema、能力门控路径 |
| 30 | `feat(routing): add the exchanges and bindings page` | 唯一一个**整页覆写**，验证设计文档第 3 节的覆写规则 |

**这一阶段最有价值的产出是失败信号，不是功能。** 如果出现下面任何一种情况，
说明抽象层次定错了，应当停下来改设计而不是继续硬接：

- 规范页面为了容纳 RabbitMQ 而需要改变结构（不只是加列或加字段）
- 某个概念既塞不进 `Options` 也塞不进驱动贡献
- 能力门控无法表达「有这个概念但语义不同」（例如积压有值但不是 offset 差）
- Exchanges 页之外还需要第二个整页覆写

## 4. 测试处理

移动的包里有 640 行测试，全部是包内纯单测，无 build tag，不需要真实 broker：

| 测试文件 | 行数 | 去向 |
| --- | --- | --- |
| `topic/enrich_test.go` | 84 | 随包移入驱动 |
| `topic/parser_test.go` | 24 | 随包移入驱动 |
| `consumer/validation_test.go` | 32 | 随包移入驱动 |
| `message/message_test.go` | 171 | 随包移入驱动 |
| `acl/errors_test.go` | 26 | 随包移入驱动 |
| `internal/mqoffset/query_test.go` | 281 | 随包移入驱动 |
| `internal/mqexec/retry_test.go` | 22 | 随包移入驱动 |
| `cluster/history_test.go` | 83 | **留在 service/** |
| `cluster/parse_test.go` | 21 | **留在 service/** |

**允许改动的只有 package 声明行和 import 路径。任何断言的改动都说明重构改变了
行为，应当停下来。**

薄编排层是新代码，需要新增测试：注册表查不到连接、能力不支持、以及第 2 节那 5
个「吞错返回空」的方法各一条。

## 5. 每步的回归确认

除了 `go build` 和 `go test`，每个阶段结束时跑一遍：

```bash
# P1 结束：service 不得反向依赖驱动，默认连接读取必须清零
grep -rn "GetDefaultClient\|GetDefaultConnection\|HasActiveDefaultClient" internal/ | grep -v "^internal/driver/"
grep -rn "internal/driver/rocketmq" internal/service/
```

```bash
# P2 结束：用重构前的配置启动，确认无感
cp ~/Library/Application\ Support/mq-studio/connections.json /tmp/pre-refactor.json
wails3 task dev   # 连接应当直接可用，凭据无需重新输入
```

```bash
# P3 结束：页面里不得残留 RocketMQ 词汇
grep -rn "NameServer\|nameServer" frontend/src/pages/
npm run check
```

```bash
# P4 结束：绿色只剩语义用途
grep -rn "bg-success\|text-success\|border-success\|var(--success)" frontend/src/
```

```bash
# P5 结束：接 RabbitMQ 的过程中，规范页面不该被改动
git diff --stat <P4 的最后一个提交>..HEAD -- frontend/src/pages/
# 期望：只有新增的 Exchanges 页，规范页面零改动或仅新增可选字段
```

人工确认的部分：P3 结束时逐屏对比重构前后的截图；P5 结束时同时连 RocketMQ 与
RabbitMQ 各跑一遍，确认导航、术语、能力门控三处都按形态正确切换。

## 6. 需要你确认的五件事

前四条上一轮问过、还没有答复，这里一并列出。确认后我从提交 1 开始。

1. **分支名。** 已建 `refactor/multi-mq-driver`，遵循 CLAUDE.md 的
   `refactor/<描述>` 约定。你说的「mq-studio 分支」我理解为「在 mq-studio 里开
   分支」；如果你要的是字面上叫 `mq-studio` 的分支，我改。
2. **1.1 的超时改由 context 携带**，驱动对 Settings 零依赖。这是对现有写法的
   改变，虽然不影响行为，但会让每个驱动的方法签名都带 `ctx`。
3. **1.2 的薄编排层。** 另一种做法是 bridge 直接调驱动、不要这一层，代价是那
   五项职责在 29 个 bridge 方法里重复。我倾向保留薄层。
4. **第 2 节那 5 处「吞错返回空」逐字保留。** 它们是当前行为，保留意味着新代码
   里要有一处看起来不太干净的例外。如果你希望顺手统一成抛错，那会改变断连时的
   界面表现，需要把它从「无感重构」里单独拿出来说。
5. **第二个驱动选 RabbitMQ（新增）。** 理由见第 0 节：它的驱动实现并不比 Kafka
   重，但验证价值高得多。需要你确认两件配套的事：
   - 你有可用的 RabbitMQ 环境吗？驱动依赖 **management 插件**；没有的话
     提交 24 会先建一个 `rabbitmq:*-management` 的 docker 环境。
   - 接受新增一个依赖 `github.com/michaelklishin/rabbit-hole/v2`。

   如果你更想要「先快速见到第二种 MQ 跑起来」，那 Kafka 是更快的路 —— 但要清楚
   它证明不了抽象是对的，真正的检验只是被推迟了。
