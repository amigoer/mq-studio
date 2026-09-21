# Agent 能力执行计划

本文是 Agent 相关能力的施工版本，填的是 [README](../README.zh-CN.md) 交付表第 16
项留下的那句「具体范围会在确定后在这里公布」。前提写在
[ROADMAP.zh-CN.md](ROADMAP.zh-CN.md)：驱动之后的工作建立在每个驱动已经声明的能力
模型之上。

**本次终点：把每一个已交付的家族按能力门控暴露成一个 MCP server，由外部 agent
驱动。应用内不跑模型，不存 provider 密钥，不做对话界面。**

**状态：M1、M2 已完成（`internal/agent/catalog`、`internal/agent/mcpserver`）。M3 起未开工。**

## 0. 开工前查清的四件事

三件让这件事比看上去小，一件让它比看上去大。

**一、`internal/app` 是 Wails-free 的，所以 MCP server 是 bridge 的兄弟，不是重写。**
整个 `internal/` 下只有两个包 import Wails：`internal/bridge` 和 `internal/tray`。
`main.go` 里的 `app.New()` 装配出 24 个业务服务，全程不碰 Wails；
`internal/bridge/bridge.go` 只是把它们包成 Wails service 注册一遍。MCP 适配器接的
是同一个 `*app.Services`，和 bridge 平级。

**二、按 id 取实时连接已经是正式契约。** `Conns func(connID int) (driver.Conn, error)`
（`internal/app/connsource.go`）。它的注释记着这个契约曾经名存实亡——每个调用者
拿到的都是同一个进程级客户端——现在由 registry 按 profile id 分发，且无法解析的 id
是错误而不是静默回退。这一条对 agent 恰好是必须的：开着三个集群时答错一个，比不答
更糟。

**三、「声明」与「实现」不许分家这条规矩已经有执法者。** `CheckConformance`
（`internal/driver/conformance.go`）拿一张 71 行的 capability → interface 表去比对
每个 `Conn`，每个驱动的测试都调它。操作目录要做的是给这张表加第三列，而不是另起
一张表。

**四、但能力模型不是工具契约——本次真正的工作量在这里。**

README 说「这套能力模型正是 Agent 跨中间件工作的前提」，这句话没错，但它是必要条件
不是充分条件。`Capability` 回答的是「这个端点能不能做 X」。它不回答另外三个问题，
而一个会调工具的模型三个都要：**X 收什么参数、X 的破坏半径多大、做完之后怎么确认
它真的生效了。**

真正执行操作的是 `internal/bridge` 的 305 个导出方法。它们对模型完全不可读，而且
**其中一部分是 RocketMQ 形状的**：`TopicInput`（`internal/bridge/topic.go`）带着
`BrokerAddr` / `ReadQueue` / `WriteQueue` / `Perm` 四个字段，它的 `spec()` 直接写
`rocketmq.Attr*` 键。照着 bridge 反射出一套工具，等于让模型在创建 Kafka topic 时去
填 `brokerAddr` 和 `perm`。

家族之间真正的差异活在 `DestinationSpec.Attributes map[string]string` 里，而
`internal/driver/*` 下一共有 **519 个不重复的 `Attr*` 键**，没有一个带类型。
`DriverDescriptor.Form` 只描述连接表单，不描述任何一个操作的参数。**所以「某个操作
在某个家族收什么参数」这件事，今天在代码里没有任何地方声明过。** 这就是 M1。

> 这类错误在本仓库有先例，代价也是真实的：连接凭据曾经同样是 RocketMQ 形状的，
> 一个家族声明的认证方式会在拨号时被重置掉，直到 NATS 驱动第一次去读 profile 的
> 认证方式才暴露。工具契约如果照着 bridge 的现状长出来，等于把同一个错误复制 305
> 次，而且这次没有界面去暴露它。

## 1. 全局约束

四条，违反任何一条就停下来重新对齐。

1. **本次不在应用内跑模型。** 不引入 provider SDK，不加 API key 字段，不做对话
   界面。M4 的 GUI 改动只有一个开关和一处状态。
2. **目录声明与端口实现不许分家。** 沿用 `CheckConformance` 的规矩：目录里声明的
   每个操作都必须对应一个驱动确实实现了的端口，不一致是**测试失败**，而不是运行时
   报错。
3. **工具不得比界面更富。** 界面做不到的事，工具也不提供；凡是工具能做的，界面上
   都找得到对应入口。不接受「Agent 能改、用户改不了」的操作。
4. **caveat 必须进工具返回值。** 「RabbitMQ 浏览走 `basic.get`，会改队列状态」这类
   注意事项今天只画在界面上。模型看不见界面，不被告知就会把它当作无副作用的读来
   用。降级原因同理：读不到就要说明为什么，而不是返回一个空列表。

## 2. 里程碑

| 阶段 | 范围 | 完成判据 |
| --- | --- | --- |
| M1 | 操作目录，不含任何 MCP 代码 | **已完成。** 124 个操作覆盖全部 71 个能力；15 个驱动的 conformance 测试各多一条 `catalog.CheckCoverage` |
| M2 | 只读工具集 + `mq-studio mcp` 子命令 | **已完成。** 7 个只读工具；对真实 broker 的 live 测试断言工具与 service 层答案一致，且会话前后 profile 文件逐字节未变 |
| M3 | 写操作与破坏半径门控 | 默认启动下，清空 / 删除 / 重置位点在 `tools/list` 里根本不出现 |
| M4 | GUI 侧的开关与可见性 | 用户能看见 agent 正在动他的集群，并且能一键掐断 |
| M5 | 文档 | README 第 16 项、ROADMAP 交付表、`ARCHITECTURE.md` 的进程模型三处同时为真 |

### M1 · 操作目录

**已完成**，落在 `internal/agent/catalog`：124 个操作，覆盖 `internal/model` 里全部
71 个能力，不多也不少。每行声明能力、端口、方法、破坏半径、请求与返回类型，以及这个
写操作是否带家族逃生舱。

每行的能力归属不是新做的判断，而是照抄 service 层已经做过的那个：`internal/service`
里 151 处 `port[driver.X](s, connID, model.CapY)` 调用，每一处就是一个操作的「端口 +
能力」配对，而且是应用真正在跑的那份。照它写，目录就不可能描述一个应用随后会拒绝的
操作。破坏半径是这份目录自己的贡献，也是它手写而不是生成的原因——签名里没有任何东西
说清空不可撤销而更新可以。

**两处偏离原计划，都是往少写的方向：**

**一、目录不复述请求与返回的字段，只指向类型。** 原计划写的是「参数 schema」。但那些
形状已经在 `internal/model` 里声明过一次，带着它们过桥用的 json tag；再抄一份就是第二
个要保持同步的地方，而这个仓库的家族清单正是这样过期的。所以操作持有的是
`reflect.Type`，由编译器盯着；从类型生成 JSON schema 是 M2 的事，确定性的。只有端口
本身收散参数（没有请求结构体可指）时才退回逐个声明。

**二、写属性只声明写入侧的键。** 原计划的判据是「写操作会用到的属性键都有声明」。实际
量下来是 11 个家族、40 个键，不是 519——读取侧返回几百个键，但调用方读结果时不需要
预先知道它们，它们带着值和名字一起回来；组装写入的人才是什么都没有。

**三条测试把目录钉在代码上：**

- `TestEveryOperationIsBackedByItsPort` —— 每个操作的（能力，端口）配对必须在
  `driver.CapabilityPorts()` 里有对应行。只有两个端口不在那张表上，各自搭在别的能力
  上（`QueueGuardedRemover` 搭 `destination.delete`，`SubscriptionStats` 搭
  `subscription.lag`），测试把这两个钉死，出现第三个就红。
- `TestWriteAttributeKeysMatchWhatTheDriversRead` —— 用 `go/ast` 扫 `internal/driver`，
  把每个驱动从写入 spec 里读出的属性键解析出来，与目录的声明双向比对。驱动读了而目录
  没声明，或者目录声明了而没有驱动读，都是失败。这一条是「声明即契约」唯一的执法者，
  因为这些键是索引进 `map[string]string` 的字符串常量，没有任何类型可反射。
- `catalog.CheckCoverage(conn)` —— 加进了 15 个驱动各自的 conformance 测试，紧挨着
  `driver.CheckConformance`。驱动声明了某个能力而目录没有对应操作，就是一个人能在界面
  上操作、而读目录的调用方根本看不见的页面。

**一个顺带查出来的事实：** `NamespaceSpec` 完全是有类型的，没有 `Attributes` 逃生舱。
我一开始按别的 spec 的样子给 `namespace.save` 标了「带属性」，是错的。现在有一条反射
断言：`CarriesAttributes` 为真，当且仅当请求类型确实有 `Attributes map[string]string`
字段。这类错误不会再靠人眼发现。

### M2 · 只读工具集与 stdio 子命令

**已完成**，落在 `internal/agent/mcpserver` 与根目录的 `mcp.go`。7 个工具：
`connections_list`、`capabilities_describe`、`destinations_list`、
`destination_detail`、`subscriptions_list`、`messages_browse`、`cluster_topology`，
每个都带 `readOnlyHint` 注解。握手时的 instructions 直接告诉客户端从
`connections_list` 开始、再对要操作的连接调 `capabilities_describe`——因为「能做什么」
是端点的属性而不是家族的属性，这件事没法从工具列表里看出来。

**未决问题 1 已定：用官方 SDK**（`modelcontextprotocol/go-sdk v1.8.0`）。实测代价
**2.4 MB**（84.3 → 86.7 MB），不是空模块里量出来的 8.5 MB——这个应用本来就链接了 SDK
依赖里的大部分。

**开工后查出三件事，每一件都改了做法，而且都是同一类问题：这个进程不拥有那些文件。**

1. **`Connect` 会写 profile 存储。** `connectRuntimeLocked` 设完 `StatusOnline` 和
   `LastCheck` 就整文件重写。所以加了 `connection.Service.OpenReadOnly`：解析路径和
   `Connect` 一模一样（全局凭据、家族自己的认证方式都照走），只是什么都不记。
2. **`app.New()` 还有两件事是窗口专属的，而且都写盘**：采集器按定时把 TPS 历史整文件
   写出去，`ConnectDefault` 在后台走的正是 `Connect`。于是拆出 `app.NewReadOnly`，
   两件都不做。
3. **驱动注册是进程级的**，`Register` 对重复注册会 panic（这是对的：两个驱动抢同一个
   kind 是构建错误）。一个进程里装配两次服务在此之前不可能发生，所以这一点从没暴露过；
   现在注册包在 `sync.OnceFunc` 里。

**三条 live 测试，对着 `npm run e2e:rabbitmq:up` 起的真 broker 跑过：**

- 工具返回的 destination 集合与 `services.Topics.List` 完全一致——服务端是同一套
  service 之上的第二个适配器，「答案相同」是它唯一的主张，而一个悄悄读了别处的工具能
  通过这个仓库里所有离线测试。
- 浏览的 caveat 走到了工具返回值里。RabbitMQ 的浏览走 `basic.get` 会改队列状态，而一个
  没有界面的调用方没有第二个地方能知道这件事。
- **一次完整会话（含打开一个此前未打开的连接）之后，profile 文件逐字节未变。** 把
  `OpenReadOnly` 换回 `Connect` 这条就会红，试过。

**没做的部分：** 另外 14 个家族的 live 平价断言。测试本身是家族无关的，加一个家族就是
一次调用加一个 profile，但每个都要先把对应的 broker 起起来，所以这一轮只做了 RabbitMQ。

### M3 · 写操作与破坏半径门控

发消息、建删 destination、重置位点、清空、重投。

`destructive` 一档默认不出现在 `tools/list` 里，要显式开启——用命令行 flag 而不是
应用设置项，因为决定权应该在启动 agent 的那个人手里，而不是在一个可能几周前点过一次
的开关里。`mutate` 与 `destructive` 的每次返回都要带上它改动了什么。

**判据：** 默认启动下清空、删除、重置位点不可见；开启后每次调用的返回里都说明了改动
范围和对应的 caveat。

### M4 · GUI 侧的开关与可见性

设置里一个开关，加一处状态：谁连着、最近一次调用是什么。以及可选的 GUI 托管传输——
让 agent 操作用户此刻开着的那个连接，顺带绕开第 3 节的双写者问题。

**判据：** 用户能看见 agent 正在动他的集群，并且能一键掐断。

### M5 · 文档

README 第 16 项、ROADMAP 交付表，以及 `docs/ARCHITECTURE.md` 的进程模型——它现在写着
「没有本地 HTTP server、没有 auth token、没有要照看的子进程」。M2 之后这句话不再成立，
改它是 M5 的一部分，不是可选项。

## 3. 传输与并发约束

profile 存储是**整文件原子重写 + 进程内互斥**（`internal/service/connection/persistence.go`
走 `internal/storage/atomicfile`）。跨进程没有任何锁，所以两个进程同时写，后写的那个
会整份覆盖前一个。

由此定下两条：

- **stdio 子命令对 profile 只读**：不建、不改、不删连接。agent 需要新连接时，让用户
  在界面里建——这同时也满足约束 3。
- 需要「操作用户此刻打开的那个连接」时，才需要 GUI 托管传输，那是 M4 而不是 M2。

加密密钥不构成障碍：`crypto.InitKey` 读的是数据目录下同一个 `secret.key`，子进程解得
出凭据，不需要第二套密钥，也不需要把任何密钥复制出去。

另有一条已知的串行点，会影响 agent 跨连接工作的体感：`internal/service/connection`
里 `Connect`、`TestConnection`、`Disconnect`、`UpdateConnection`、`SetOption`、
`DeleteConnection` 六个方法都在同一把 `runtimeMu` 下，Go 严格一个一个来。已经打开的
连接不受影响（`driver.Conn` 的契约要求并发安全），但一次拨开五个连接，第五个会把前
四个的等待算进自己的往返里。界面上的批量操作已经因此改成逐个执行。

## 4. 测试策略

**目录与工具分发是确定性的**，现有 fake 就能覆盖，不需要模型参与。

每个家族已经有 live 套件和真实 broker，一次 MCP 工具调用可以和一个 bridge 方法用完全
一样的方式断言。全程不引入任何「要模型在场才能跑」的断言——这是本次选 MCP server 而不
是应用内助手的主要理由之一。

顺带记一件事实：`internal/bridge` 今天一个测试文件都没有。MCP 适配器不沿用这一点，它
是这一层第一个自带测试的适配器。

## 5. 明确不做

- **应用内对话助手、provider 配置、API key 存储。** 等操作目录稳定之后另起一轮；届时
  它是目录之上的一个客户端，而不是另一套实现。
- **让 agent 创建或修改连接 profile。** 理由见第 3 节。
- **任何界面上没有的操作。** 见约束 3。
- **把 MCP server 做成独立发行物。** 它是应用的一个子命令，跟着应用一起走。

## 6. 未决问题

1. ~~**MCP 实现用官方 Go SDK 还是自己写 stdio JSON-RPC？**~~ 已定：官方 SDK，实测
   2.4 MB。
2. **工具粒度：** 一个 `destination.list` 吃下所有家族，还是按家族分开？倾向前者加
   `capabilities.describe`，但要先拿 IBM MQ 的 channel 和 Kinesis 的 shard 验一遍——这
   两样在规范页面里都没有对应物，各自拿了独立的端口和页面。
3. **destructive 的开启方式：** flag、环境变量，还是每次调用都要确认。
4. **一次会话能不能同时操作多个 connID。** 技术上可以，registry 本来就按 id 分发；要
   先想清楚的是拨号串行（第 3 节）会让模型看到什么样的时序。
