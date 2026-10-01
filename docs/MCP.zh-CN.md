# 给 agent 用（MCP）

[English](MCP.md)

同一个二进制可以作为 [MCP](https://modelcontextprotocol.io) server 运行，让 Claude Code 这类 agent 使用这些连接。它读的是应用自己的连接配置，不需要把地址和凭证再填一遍，窗口也不必开着。

## 接入客户端

```bash
claude mcp add mq-studio -- "/Applications/MQ Studio.app/Contents/MacOS/mq-studio" mcp
```

用配置文件接入的客户端，填的也是这两样：可执行文件，加上参数 `mcp`。多数客户端读的是 `mcpServers` 这种写法：

```json
{
  "mcpServers": {
    "mq-studio": {
      "command": "/Applications/MQ Studio.app/Contents/MacOS/mq-studio",
      "args": ["mcp"]
    }
  }
}
```

## 能走多远

**默认只读。** 写操作要在启动时显式放行，是一个上限而不是逐项开关：

| 启动参数 | 多出来的能力 |
| --- | --- |
| 不传 | 列连接、namespace、目标与订阅；浏览消息、按 ID 读一条或追踪它的去向；读集群、健康检查、分区、路由、死信与消费进度；列出连着的客户端及其信道；读 Kinesis 的分片与 IBM MQ 的通道 |
| `--allow mutate` | 建目标、发消息或追加 stream 条目、重投死信、移动读取位点 |
| `--allow destructive` | 清空目标、删除目标 |

上限之上的工具根本不出现在工具列表里 —— 没被告知存在的工具，模型无法调用。决定权因此在启动它的人手里，而不是在应用里某个几周前点过的开关上。

## 只对一个连接放宽

上限也可以只对某一个连接放宽，用它在窗口里显示的名字点名 —— 为了清空一个测试队列而开的 destructive，就不会连生产集群一起放开：

```bash
claude mcp add mq-studio -- "/Applications/MQ Studio.app/Contents/MacOS/mq-studio" mcp --allow scratch=destructive
```

其余连接仍然只读（或者停在不带名字的 `--allow` 给的那一档），超出这一档的工具在它们上面会在拨号之前被拒绝；`connections_list` 会告诉 agent 每个连接能走多远。名字在 server 启动时绑定到它当时指的那个连接：之后用同一个名字保存的连接不在其内，在窗口里被改指到别的 broker 或换了凭据的连接也随即失效。名字对不上任何已存的连接、或者对上不止一个，server 会在启动时拒绝，而不是悄悄什么都不放行。

## 清空和删除要人确认

执行之前，server 会通过 agent 客户端向你提问 —— 目标、所在连接、现在持有多少消息，以及这个家族附带的后果，和窗口自己的确认框一样 —— 只有明确同意才会执行。不能提问的客户端（连接时没有声明 MCP elicitation）两者都会被直接拒绝。拒绝对这次调用是最终的；你看确认框的时候，连接如果在窗口里被改指到别处，也不会动它。

## 一个连接能做什么

让 agent 先调 `capabilities_describe`：**一个连接能做什么由这个端点自己回答**，同一个家族的两个端点可以不同，而中间件做不到的操作不会被提供。带后果的操作会把后果一起返回 —— 浏览 RabbitMQ 队列会改队列状态，清空 Kafka topic 则位点继续往前数。namespace 只有按它划分目标的家族才收，其余家族会直接拒绝，而不是悄悄忽略。

它不会写应用的连接配置：那个文件由窗口整体重写，两个写者会互相覆盖。但每次调用前都会重读一遍，所以在窗口里保存的连接，agent 的下一次调用就能用。

## 每个写操作都有记录

agent 发起的每个写操作 —— 完成的、失败的、被上限拒绝的 —— 都会以一行 JSON 追加到应用数据目录下的 `agent-audit.jsonl`（设置 → 数据与备份 → 打开目录）：什么时间、哪个客户端、在哪个连接上调了哪个工具、带什么参数、改了什么；清空和删除还会记下给人看的问题和对方的回答。写操作在执行之前先记下，记不下来就不执行，所以只有开始、没有结果的记录，说明 server 在 broker 回答之前就停了。消息正文不落盘，只记大小和 SHA-256 摘要。读操作不记录。

## 工具

除 `connections_list` 外，每个工具都要传一个从它拿到的连接 ID；对做不到这项操作的端点调用，会直接拒绝并说明原因，而不会去尝试。

| 上限 | 工具 |
| --- | --- |
| read | `connections_list`、`capabilities_describe`、`namespaces_list`、`destinations_list`、`destination_detail`、`destination_partitions`、`destination_shards`、`subscriptions_list`、`subscription_lag`、`subscription_consumers`、`subscription_group_consumers`、`subscription_pending_summary`、`subscription_pending_entries`、`messages_browse`、`message_by_id`、`message_track`、`messages_dead_letters`、`messages_retry_queue`、`dead_letter_queues`、`routing_exchanges`、`routing_bindings`、`cluster_topology`、`cluster_health`、`client_connections`、`client_channels`、`channels_list` |
| mutate | `destination_create`、`message_publish`、`message_add_entry`、`message_resend`、`subscription_reset_offset` |
| destructive | `destination_purge`、`destination_delete` |

这个 server 的范围与背后的决定见 [AGENT_PLAN.md](AGENT_PLAN.md)；它和窗口怎么并存，见 [ARCHITECTURE.md](ARCHITECTURE.md#the-mcp-server)。
