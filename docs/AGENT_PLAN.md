# Agent 能力执行计划

本文是 Agent 相关能力的施工版本，填的是 [README](../README.zh-CN.md) 交付表第 16
项留下的那句「具体范围会在确定后在这里公布」。前提写在
[ROADMAP.zh-CN.md](ROADMAP.zh-CN.md)：驱动之后的工作建立在每个驱动已经声明的能力
模型之上。

**本次终点：把每一个已交付的家族按能力门控暴露成一个 MCP server，由外部 agent
驱动。应用内不跑模型，不存 provider 密钥，不做对话界面。**

**状态：M1、M2、M3、M5 已完成。M4 经评估后不做，理由见下。**

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
| M3 | 写操作与破坏半径门控 | **已完成。** 默认 7 个工具全只读；`--allow mutate` 11 个，`--allow destructive` 13 个；写操作的效果与 caveat 都在返回值里，并有真 broker 验证 |
| M4 | GUI 侧的开关与可见性 | **不做。** 它的判据只有在 GUI 自己托管传输时才成立，而那要给桌面应用加一个能清空队列的监听端口 |
| M5 | 文档 | **已完成。** README（双语）、ROADMAP（双语）、`ARCHITECTURE.md` 的进程模型、网站文案与 CHANGELOG 同时为真 |

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

**已完成。** 六个写工具：`destination_create`、`message_publish`、`message_resend`、
`subscription_reset_offset`（mutate 档），`destination_purge`、`destination_delete`
（destructive 档）。

**门控做成了一个上限而不是一个集合**：`mq-studio mcp --allow read|mutate|destructive`，
默认 `read`。上限之上的工具**根本不出现在 `tools/list` 里**——一个没被告知存在的工具，
模型无法调用，这比调用时拒绝更强：没有可以被说服的余地。认不出的取值什么都不放行，
所以 flag 打错字不会意外放宽。

**可见性和协议注解都从目录推导**，不是手写第二份。`catalog.Permits` 决定放不放行，
`annotate()` 把 `Blast` 翻成 `readOnlyHint` / `destructiveHint`。一个注解说只读而目录
说破坏的工具，会恰好在最不该被信任的地方被信任——所以这两处必须是同一个事实。

**M1 的属性声明在这里第一次派上用场。** `destination_create` 收一个 `attributes`，
而 `capabilities_describe` 现在会告诉调用方**这个家族在这个操作上到底收哪些键**（类型、
必填、枚举取值、默认值）。更重要的是反过来那一半：**家族不读的键会被当场拒绝，并列出
它真正收的那些**。驱动本来会静默丢弃它——调用方要了 quorum 队列、拿到 classic，而调用
成功了，事后无从分辨。这是唯一一种调用方检测不到的失败。

**每个写操作的返回都带 `effect.changed`**，用这个家族自己的说法讲它改了什么，外加连接
声明的 caveat。

**顺带补了一条驱动声明，因为是这次新暴露的危险点。** Kafka 的「清空」在 service 层叫
`TruncateTopic`，语义和队列的清空不同：位点继续往前数，原本在 900 的消费者仍在 900、
只是变成已追平。界面的确认框一直这么写，但驱动没把它声明成 caveat——也就是说人看得到、
agent 看不到，而这一档恰恰是破坏性的。现在 `internal/driver/kafka/conn.go` 声明了它。

> **更正一处我先前写错的数字。** 我一度以为整个代码库只有一条 caveat 声明，因为只
> grep 了 `WithCaveat(`。实际有 **9 条、跨 7 个家族**：另一半是直接写在 `Caveats:` map
> 字面量里的，还有一个家族名带连字符（`google-pubsub`）躲过了我的正则。所以这条通道
> 比我说的健康得多。
>
> **仍然成立的那一半：** `frontend/src/mq/capabilities.ts` 的 `caveat` 访问器没有任何
> board 在调用——界面是每个对话框自己硬写文案。这条通道在 Go 侧是通的、在渲染层是断的。

**六条 live 测试，对着真 RabbitMQ 跑过：** 除 M2 的三条之外，新增一条完整写周期
（建 → 发 → 清空 → 删，每一步都回broker 核对状态，而不是只看调用成功）、一条断言家族
不读的设置会被拒绝、一条断言默认服务端提供的每个工具都是只读的。四次写 broker 之后，
profile 文件依然逐字节未变。

### M4 · GUI 侧的开关与可见性

**评估后不做。**

写这份计划时以为这是「加一个开关和一处状态」。真要做的时候才看清：**stdio 子命令是独立
进程，窗口根本看不见它** —— 自己的 `app.Services`、自己的 registry、没有任何 IPC。所以
「用户能看见 agent 正在动他的集群，并且能一键掐断」这条判据，只有在 GUI 自己托管传输时才
成立，而 SDK 只提供 HTTP 系（SSE / Streamable）作为网络传输。

那就意味着：给一个本地优先的桌面应用加一个能清空队列的监听端口，外加要生成、存储、展示给
用户的 token。这不是一个开关的成本，是产品安全姿态的改变，而 `ARCHITECTURE.md` 恰恰以
「没有本地 HTTP server、没有 auth token」作为它的一部分。

不做的另一半理由是它要解决的问题其实不大：stdio server 的生命周期跟着 agent 客户端走，
不是一个会被遗忘在后台的常驻进程；而「agent 正在做什么」这件事，agent 客户端本来就在逐条
展示工具调用——可见性已经在那里了，只是不在这个窗口里。

如果以后真的需要「让 agent 操作用户此刻开着的那个连接」，这一节要重开，而且第一个要回答的
问题是监听端口和 token，不是开关放在设置页的哪一栏。

### M5 · 文档

**已完成。** 改动的地方比计划里点名的三处多，因为「Agent 是下一步」这句话散落在好几份文件里：

- **README（双语）** —— 交付表第 16 项改为已完成，并新增「给 agent 用（MCP）」一节：一条
  `claude mcp add` 命令、三档上限的表格，以及两条最要紧的事实（能力由端点自己回答、不会写
  连接配置）。
- **ROADMAP（双语）** —— 「范围确定后在 README 公布」改为已落地，并指向本文件。
- **`docs/ARCHITECTURE.md`** —— 进程模型图原本的栈底写着「RocketMQ Admin API」，这在十五个
  家族之后本来就不成立；现在画的是两个适配器共用一套 service，外加 `internal/driver`。新增
  一节讲 `internal/agent` 的两个包和那条上限。
- **网站文案（双语）** —— `drivers.planned` 与 `roadmap.stages` 里的 Agent 条目。
- **CHANGELOG（双语）** —— 未发布一节。

**一处更正**：动手前我以为 `ARCHITECTURE.md` 里「没有本地 HTTP server、没有 auth token、
没有要照看的子进程」这句会作废。实际读下来它对窗口依然成立——stdio server 不是窗口拉起的子
进程，也没有监听端口。文档缺的不是更正而是补充：**第二个入口**。

## 2.5 本地实跑查出的缺陷：i18n key 泄漏

M2/M3 都声称「caveat 走到了调用方手里」，而本地第一次真跑就戳穿了它：回来的是
`mq.rabbitmq.caveat.browseAltersQueue`，不是句子。

**能力模型里的文案全是 i18n key**，由渲染层翻译——这对窗口是对的（文案要跟着读者的语言
走，翻译也该和界面其余部分放在一起），但一个没有渲染层的调用方拿到的是一个无法解读的
字符串。降级原因同理，而它的数量比 caveat 多得多。

两处修正：

1. **我自己加的 Kafka caveat 写成了英文原文**，违反了另外 8 条都遵守的约定——如果界面哪天
   真的读 caveat，它会是唯一一条不翻译的。改成了 `mq.kafka.caveat.truncateKeepsOffsets`，
   并补了中英两份译文。
2. **MCP server 现在解析 key。** 译文嵌在 `phrasebook.go` 里——只能放在根包，因为
   `go:embed` 出不了自己的包目录，而 `frontend/**` 只有根包够得着；解析器注入给
   `mcpserver.New`，理由和 `registryRuntime` 住在 `internal/app` 是同一条：只有组装根
   可以同时知道两边。语言跟随应用设置，解析不到的 key 原样返回——空字符串会被读成
   「这个操作没有后果」。

**测试**：`phrasebook_test.go` 用 `go/ast` 扫出每个驱动实际声明的 caveat（两种写法都认），
断言它既是 i18n key、又能在中英两份文件里解析出来。这条测试第一次跑就抓到了我自己的
英文原文。前端本来就有一份手抄的 `degradedReasons.test.ts` 做同样的事——注释里写的正是
同一种故障（「有人想知道页面为什么被挡住，看到的是 mq.mqtt.degraded.managementAbsent」）
——新加的 Kafka 条目也补进了它的清单。

## 2.6 补上死信与消费进度，以及它暴露的一个目录缺陷

**新增 8 个只读工具**，只读档从 7 个变成 15 个：

- **死信**：`messages_dead_letters`、`messages_retry_queue`（重试和死信是两个阶段，前者还会
  被投递，后者不会）、`dead_letter_queues`（按拓扑倒着找，给那些「死信队列是约定而不是对象」
  的家族）。
- **消费进度**：`subscription_lag`（分区级，回答「积压是摊开的还是压在一个分区上」）、
  `subscription_consumers`、以及 PEL 那三个：`subscription_pending_summary`、
  `subscription_pending_entries`、`subscription_group_consumers`。

一半没有家族中立的 service 方法（死信拓扑和 PEL 都只活在家族服务里），按 purge 那次定下的
规矩直接走端口——目录已经点名了每个家族都实现的那个接口，所以这条路不需要一份会过期的家族
清单。

**然后 live 测试撞出了一个目录缺陷，而它恰好是这个应用存在的理由所指的那种。**

`subscription.lag` 的端口是 `SubscriptionStats`，而那是一个「搭车」端口：它没有自己的能力，
`backings()` 里没有它，于是 `CheckConformance` 从不断言它。实际数字是
**12 个家族声明 `CapSubscriptionLag`，只有 3 个实现 `SubscriptionStats`** ——其余 9 个的积压
是随订阅列表一起回来的，根本没有分区级调用可做。

也就是说：目录会在 9 个家族上宣称一个一调用就报错的操作，而 `capabilities_describe` 会说它
可达。**这正是「不给出中间件做不到的操作」这条承诺的反面。**

修法在目录层：`Operation` 多了一个 `Implemented func(driver.Conn) bool`，只有那两个搭车端口
设置它，`For()` 据此过滤。`CheckCoverage` 不受影响——它问的是「目录里有没有这个能力的操作」，
不是「这个端点解析出了几个」，而一个靠列表回答积压的家族并不是缺口。

调用被拒时说的也是这件事本身，而不是「不支持」：

> rabbitmq reports subscription.lag through its listing rather than through a call of its own,
> so there is nothing more to read here

## 2.7 窗口的文件只在启动时读了一次

第 3 节给 agent 的办法是「需要新连接时，让用户在界面里建」，而这条路此前走不通：
`app.NewReadOnly()` 只在启动时读一次连接与设置，之后 `GetConnections` 和 `GetSettings`
返回的都是内存里那份。用户在窗口里新建的连接 agent 看不见，删掉的还在列表里，改过密码的
仍按旧密码拨号；`withTimeout` 注释里「窗口的改动能传到跑了几天的 server」这句也不成立。

现在每次 `tools/call` 之前，中间件调 `app.Services.RefreshReadOnly`，先设置、后连接：

- **文件没变就什么都不做。** 比较的是上次读到的字节，所以常见情况只多一次读文件，而且不碰
  `runtimeMu`——拨号期间一直持有它。
- **只丢掉真的变了的客户端。** 窗口每次连接都会重写整份文件（写状态），所以判断用的是窗口
  自己编辑时用的 `dialParametersChanged`，比较对象是当初实际拨号用的那份，而不是文件里的旧值
  ——只改了设置的情况（全局凭据）也因此能被发现。
- **读不出来就让这次调用失败。** 启动时读到的旧副本可能列着用户已经删掉的连接，而答案里不会
  有任何迹象。

顺带修了三处：`dialParametersChanged` 原来只问认证方式是不是 ACL，Kafka 从 SASL/PLAIN 切到
SCRAM 时窗口也不会重拨（单独一个提交，已进 CHANGELOG）；两个调用同时发现某个连接没打开时，
第二次拨号会替换并关掉第一个调用正在用的客户端，现在 `OpenReadOnly` 见到已打开的就沿用；
译文语言改为按调用时读取，窗口里切换语言会反映到 caveat 上。

**测试**：连接服务 7 条（两个 `Service` 共用一个文件，模拟两个进程）、设置服务与译文各 1 条、协议层
2 条；去掉中间件后协议层两条都红，失败信息就是缺陷本身。RabbitMQ live 套件 7 条照过，包括
会话前后 profile 文件逐字节未变。

## 3. 传输与并发约束

profile 存储是**整文件原子重写 + 进程内互斥**（`internal/service/connection/persistence.go`
走 `internal/storage/atomicfile`）。跨进程没有任何锁，所以两个进程同时写，后写的那个
会整份覆盖前一个。

由此定下两条：

- **stdio 子命令对 profile 只读**：不建、不改、不删连接。agent 需要新连接时，让用户
  在界面里建——这同时也满足约束 3。保存之后下一次工具调用就能用到，见 2.7。
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
3. ~~**destructive 的开启方式：**~~ 已定：命令行 flag `--allow`，三档上限，默认最窄。
4. **一次会话能不能同时操作多个 connID。** 技术上可以，registry 本来就按 id 分发；要
   先想清楚的是拨号串行（第 3 节）会让模型看到什么样的时序。
