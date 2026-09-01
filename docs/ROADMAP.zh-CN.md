# 路线图

[English](ROADMAP.md)

MQ Studio 正在成为一个覆盖所有消息队列的桌面客户端。每种中间件形态都通过可插拔驱动接入，
驱动声明自己的能力，界面只呈现当前连接的端点真正支持的功能。

本文是交付计划。它所交付的契约在[多 MQ 架构设计](MULTI_MQ_DESIGN.md)，面向用户的简版状态表
在 [README](../README.zh-CN.md)。

## 当前状态

- **已发布** — RocketMQ 4.x / 5.x，通过 Admin API 提供完整功能。
- **已发布** — RabbitMQ 3.x / 4.x，管理面走 HTTP 管理插件，数据面走 AMQP 0-9-1 而不是
  管理接口的 publish 与 get。管理面是完整的：带完整 arguments 的队列、Exchange 与
  Binding、连接与信道、死信、带健康检查与特性开关的节点、虚拟主机、用户与权限、策略与
  参数、定义导入导出、Shovel 与 Federation，以及 stream 队列。
- **已发布** — Kafka 3.x / 4.x，直接走 Kafka 协议本身（franz-go 与 kadm）。带分区、副本与
  配置的 Topic；带每分区 lag 与 Kafka 全部五种 offset 重置的消费组；按 offset、时间戳或
  key 浏览日志并跟随末尾；带 key、header、指定分区与 ack 级别的发送；带生效配置与日志目录
  的 Broker；ACL 与 SCRAM 用户；客户端配额；分区重分配与优先副本选举；以及集群正在跟踪的
  事务。
- **已发布** — MQTT 3.1.1 与 5.0，走 Paho 的两个 Go 库——它们互不重叠：一个只说 3.1.1，
  另一个只说 5.0，而配置成其中一种的 broker 会拒绝另一种的 CONNECT。这是第一个自身没有
  管理面的家族，所以一条连接能做什么是在拨号时按三层决定的：协议本身、多数 broker 会发布
  的 $SYS 树，以及 EMQX 等自带的 REST API。带 QoS、retain 与 5.0 属性的发布；实时订阅
  工作台，会报告丢弃了多少条、会话何时断开；从保留消息得出的主题列表——那是 MQTT 唯一
  能枚举的东西；来自 $SYS 的 broker 计数；以及在管理 API 有应答时，在线客户端与它们的
  会话、订阅、集群节点，并可断开某个会话。探测不到的那一层会连同原因一起上报，而不是
  让页面空着。
- **已完成设计，尚未实现** — 下面列出的十一种形态。

## 交付顺序

| 阶段 | 范围 | 完成判据 |
| --- | --- | --- |
| 0–3 | 驱动接缝本身：契约、后端端口、存储与 bridge、前端注册表 | 对 RocketMQ 而言逐屏与之前完全一致 |
| 4 | **RabbitMQ** | 已完成。Exchanges/Bindings 页面存在，且没有 offset 概念泄漏进 UI |
| 5 | **Kafka** | Topic、消费组、lag、浏览与发布端到端可用 |
| 6 | **MQTT** | 已完成。第一个自身没有管理面的家族：能做什么在连接时按三层探测——协议层、$SYS 树、broker 自带的 REST API——探测不到的那层会说明原因，而不是默默变空 |
| 7 | **Pulsar**，然后 **Redis Stream**，然后 **NATS** | 每个都是纯增量：不改动任何规范页面 |
| 8 | **ActiveMQ / Artemis**，然后 **NSQ** | 仍是纯增量；ActiveMQ 用来检验 JMS 语义能否套进规范页面 |
| 9 | **Amazon SQS**、**Google Cloud Pub/Sub**、**Azure Service Bus**、**Amazon Kinesis**，然后 **IBM MQ** 与 **Solace PubSub+** | 连接表单能表达「没有地址，只有 region 与凭证」 |

有两个排序决定值得一直放在视野里。

**RabbitMQ 排在 Kafka 前面是刻意的。** Kafka 与 RocketMQ 足够接近，即使抽象是错的它也会顺利
跑通，因此验证不了任何东西。RabbitMQ 在 offset、分区和消费组这三件事上与 RocketMQ 意见相左，
这种不一致才使它成为真正的检验。

**云托管这一档改变的是连接表单，而不只是驱动。** 阶段 7 之前的每一种形态都是「地址 + 可选
凭证」；云托管是「region + 凭证，完全没有地址」—— 这是第一次出现 `Endpoints` 为空却仍然合法
的连接。表单能否表达这一点，应该在敲定页面契约时就解决，而不是留到阶段 8。

## 各驱动的范围

每个驱动对接什么、点亮哪些规范页面、以及做不到什么。六个规范页面是 `Destinations`、
`Subscriptions`、`Messages`、`Publish`、`Cluster` 与 `Access`。

> RabbitMQ 以下的每一行都是依据各产品公开的管理接口做出的范围估计，属于计划输入而非已验证
> 的行为 —— 每一行都在对应驱动落地时才被确认。

### 自托管

| 驱动 | 管理面 | 点亮的页面 | 主要缺口 |
| --- | --- | --- | --- |
| **RocketMQ** 4.x / 5.x | 基于 remoting 协议的 Admin API | 全部六个 | Proxy 端点能回答的远少于 NameServer，能力在连接时收窄 |
| **RabbitMQ** | HTTP 管理插件，消息面走 AMQP 0-9-1 | 全部六个，外加 Exchanges/Bindings、连接、死信、虚拟主机、策略、定义、数据搬运 | 没有 offset 与分区；没有具名消费组；没有稳定的消息 id；浏览会把读到的消息重新入队，因此带 caveat；Shovel、Federation 与 stream 协议都是插件，未装时能力降级并给出原因 |
| **Kafka** | 基于 Kafka 协议的 AdminClient | 全部六个 | ACL 取决于所配置的 authorizer；浏览是按 offset 区间拉取，不是随机访问 |
| **Pulsar** | Admin REST API | 全部六个 | tenant 与 namespace 做成范围选择器，而不是一个页面 |
| **ActiveMQ / Artemis** | 基于 JMX 的 Jolokia REST | 全部六个 | Classic 5.x 与 Artemis 暴露的管理树不同，驱动需探测实际应答的是哪一种 |
| **Redis Stream** | `XINFO`、`XRANGE`、`XADD` | Destinations、Subscriptions、Messages、Publish | 没有集群拓扑，也没有按目标划分的访问控制 |
| **NATS** | JetStream API 加服务端监控端点 | Destinations、Subscriptions、Messages、Publish、Cluster | 未启用 JetStream 时，端点退化为仅发布与订阅 |
| **NSQ** | nsqd 与 nsqlookupd HTTP 接口 | Destinations、Subscriptions、Publish、Cluster | 没有消息历史，因此没有浏览 |
| **MQTT** | 协议本身没有。连接时探测：$SYS 树，以及 broker 自带的 REST API（如果有）| 概览、主题、订阅、发布、客户端、集群、告警 | 没有消费组、没有 offset、没有历史——消息只在传输途中存在，无人订阅就没了。主题列的是持有保留消息的那些，因为别的都枚举不出来。客户端页需要管理 API，Mosquitto 没有 |

### 云托管

| 驱动 | 管理面 | 点亮的页面 | 主要缺口 |
| --- | --- | --- | --- |
| **Amazon SQS** | SQS API | Destinations、Messages、Publish | 没有消费组也没有集群；接收会启动可见性超时，因此浏览带 caveat |
| **Google Cloud Pub/Sub** | Publisher 与 Subscriber 管理 API | Destinations、Subscriptions、Publish | Subscription 是真实对象，积压量可直接对应 lag；拉取即消费，浏览需要 snapshot 或 caveat |
| **Azure Service Bus** | Service Bus 管理 API | Destinations、Subscriptions、Messages、Publish，以及路由页上的规则 | 没有集群；peek 是非破坏性的，浏览不需要 caveat |
| **Amazon Kinesis** | Kinesis API | Destinations、Subscriptions、Messages、Publish | 没有集群；Shard 不是分区，需要自己的一套列 |

### 企业

| 驱动 | 管理面 | 点亮的页面 | 主要缺口 |
| --- | --- | --- | --- |
| **IBM MQ** | 管理 REST 接口 | 全部六个 | 通道是一等概念且没有规范页面与之对应，很可能需要整页覆写 |
| **Solace PubSub+** | SEMP v2 | 全部六个 | Message VPN 做成范围选择器，与 Pulsar 的 namespace 同理 |

## 由已有驱动覆盖

协议兼容的系统不单独占用一个驱动。它们按自己所讲的协议接入对应驱动，该驱动在连接时把能力
收窄到端点实际支持的范围。

| 按此接入 | 系统 |
| --- | --- |
| Kafka | Redpanda、AutoMQ、WarpStream、Confluent、Amazon MSK、Azure Event Hubs |
| MQTT | EMQX、Mosquitto、HiveMQ、VerneMQ |
| ActiveMQ 或 RabbitMQ | Amazon MQ |
| RocketMQ | 阿里云与腾讯云的 RocketMQ |

## 不在范围内

- **ZeroMQ、nanomsg** —— 没有 broker，也就没有管理面可展示。
- **Celery、Sidekiq、BullMQ** —— 架在 Redis 或 RabbitMQ 之上的应用层任务队列。
  观测它们是另一个产品，而不是再加一个驱动。

## 驱动之外

- 恢复端到端 UI 覆盖。原有的 Playwright 套件通过 CDP 端点驱动 Electron，已随 Electron 一起
  移除；平台自带的 WebView 在 macOS 上没有等价方案。值得评估的选项：在 CI 中驱动 Linux
  WebKitGTK 构建，或用 Go 集成测试对 `tests/e2e/rocketmq` 环境覆盖相同流程。
- 更新下载进度的专门界面
- 更完整的 RocketMQ 5.x Proxy 与 ACL 管理能力

## 版本历史

### v0.1.0

随 Wails 3 重写，版本号回到 1.0 以下：早先的 1.x 线基于另一套架构，已不再发布。

- 从 Electron + 本地 Go 守护进程迁回 Wails 3
- 用进程内 Wails 绑定替换本地回环 HTTP 传输
- 保持 RocketMQ 功能、本地设置与加密格式兼容
- 提供 macOS、Windows 与 Linux 安装包
- 保留 bridge 层的敏感字段脱敏
