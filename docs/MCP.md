# MQ Studio for agents (MCP)

[简体中文](MCP.zh-CN.md)

The same binary runs as an [MCP](https://modelcontextprotocol.io) server, so an agent such as
Claude Code can work these connections. It reads the application's own profiles, so there are no
endpoints or credentials to enter a second time, and the window does not need to be open.

## Connect a client

```bash
claude mcp add mq-studio -- "/Applications/MQ Studio.app/Contents/MacOS/mq-studio" mcp
```

A client configured by file takes the same two things, the executable and the argument `mcp`. In
the `mcpServers` form most of them read:

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

## How far it may go

**Read-only by default.** Writing is allowed at startup, as a ceiling rather than a list of
switches:

| Started with | What it adds |
| --- | --- |
| nothing | List connections, namespaces, destinations and subscriptions; browse messages, read one by id or trace where one went; read the cluster, its health checks, partitions, routing, dead letters and consume progress; list the clients connected and their channels; read Kinesis shards and IBM MQ channels |
| `--allow mutate` | Create a destination, publish or append a stream entry, resend a dead letter, move a read position |
| `--allow destructive` | Empty a destination, delete a destination |

Anything above the ceiling is left out of the tool list entirely - a model cannot call a tool it
was never told about. The decision therefore belongs to whoever starts the server, at the moment
they start it, rather than to a switch in the application somebody set weeks ago.

## Raising it on one connection

A ceiling can also be raised on one connection alone, named as the window shows it, so that
emptying a scratch queue does not also allow emptying production:

```bash
claude mcp add mq-studio -- "/Applications/MQ Studio.app/Contents/MacOS/mq-studio" mcp --allow scratch=destructive
```

Every other connection stays at read, or at what a bare `--allow` gives it, and a tool above that
is refused there before anything is dialled; `connections_list` tells the agent how far each
connection may go. A name is pinned, when the server starts, to the connection it names then: one
saved later under the same name is not covered, and one pointed at another broker or given other
credentials in the window stops being covered. A name that matches no stored connection, or
several, is refused at startup rather than quietly granting nothing.

## Emptying and deleting ask a person

Before either is done, the server puts the question to you through the agent client - the
destination, its connection, how many messages it holds and any consequence its family carries,
as the window's own dialog does - and only an explicit yes goes ahead. A client that cannot ask
(one that did not offer MCP elicitation when it connected) is refused both outright. A no is final
for that call, and a connection pointed elsewhere in the window while you read is left alone.

## What a connection can do

Have the agent call `capabilities_describe` first: **what a connection can do is the endpoint's
own answer**, two endpoints of one family can differ, and an operation the broker cannot perform
is never offered. Operations with a consequence return it - browsing a RabbitMQ queue alters
that queue's state, and emptying a Kafka topic leaves its offsets counting. A namespace is taken
only by a family that keeps destinations apart by one; anywhere else it is refused rather than
ignored.

It never writes the application's profiles: the window rewrites that file whole, and two writers
would lose each other's edits. It reads them again before every call instead, so a connection
saved in the window is usable by the agent's next one.

## Every write is recorded

Each write the agent asks for - done, failed, or refused by the ceiling - is appended to
`agent-audit.jsonl` in the application's data directory (Settings → Data and backup → Open
directory), one JSON object per line: when, which client, which tool on which connection, with
what arguments, and what changed - and for emptying and deleting, the question the person was
shown and their answer. A write is recorded before it is made, and one that cannot be recorded is
not made, so a start with no outcome after it means the server stopped before the broker
answered. Message bodies are kept as a size and a SHA-256 digest, not copied. Reads are not
recorded.

## Tools

Every tool but `connections_list` takes a connection id from it, and a call on an endpoint that
cannot perform the operation is refused with the reason rather than attempted.

| Ceiling | Tools |
| --- | --- |
| read | `connections_list`, `capabilities_describe`, `namespaces_list`, `destinations_list`, `destination_detail`, `destination_partitions`, `destination_shards`, `subscriptions_list`, `subscription_lag`, `subscription_consumers`, `subscription_group_consumers`, `subscription_pending_summary`, `subscription_pending_entries`, `messages_browse`, `message_by_id`, `message_track`, `messages_dead_letters`, `messages_retry_queue`, `dead_letter_queues`, `routing_exchanges`, `routing_bindings`, `cluster_topology`, `cluster_health`, `client_connections`, `client_channels`, `channels_list` |
| mutate | `destination_create`, `message_publish`, `message_add_entry`, `message_resend`, `subscription_reset_offset` |
| destructive | `destination_purge`, `destination_delete` |

The scope and the decisions behind the server are in [AGENT_PLAN.md](AGENT_PLAN.md) (in Chinese);
how it sits beside the window is in [ARCHITECTURE.md](ARCHITECTURE.md#the-mcp-server).
