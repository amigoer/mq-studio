# Roadmap

[简体中文](ROADMAP.zh-CN.md)

MQ Studio is becoming one desktop client for every message queue. Every broker family is
reached through a pluggable driver that declares its own capabilities, and the interface
only offers what the connected endpoint can actually do.

This is the delivery plan. The contract it delivers against is
[the multi-MQ design](MULTI_MQ_DESIGN.md); the short user-facing status table lives in the
[README](../README.md).

## Where things stand

- **Shipped** — RocketMQ 4.x / 5.x through the Admin API, feature-complete.
- **Shipped** — RabbitMQ 3.x / 4.x through the HTTP management plugin, with the data plane on
  AMQP 0-9-1 rather than the management API's publish and get endpoints. The whole management
  plane: queues with their full arguments, exchanges and bindings, connections and channels,
  dead letters, nodes with health checks and feature flags, virtual hosts, users and
  permissions, policies and parameters, definitions import and export, shovels and federation,
  and stream queues.
- **Shipped** — Kafka 3.x / 4.x over the Kafka protocol itself, through franz-go and its kadm
  package. Topics with their partitions, replicas and settings; consumer groups with
  per-partition lag and all five of Kafka's offset resets; browsing a log by offset, timestamp
  or key and following its end; producing with a key, headers, a pinned partition and a chosen
  acknowledgement level; brokers with their effective settings and their log directories; ACLs
  and SCRAM users; client quotas; partition reassignment with preferred-leader election; and the
  transactions a cluster is tracking, so a pipeline stopped by a producer that died
  mid-transaction is visible somewhere.
  Broker settings are read-only. Everything needed to write them is in place - the driver reads
  them through the same incremental-alter path a topic's settings use - but the page offers no
  editor, and a cluster-wide setting and a per-broker override are different writes that deserve
  to be told apart before either is offered.

  Three things it deliberately does not have. There is no dead-letter page: Kafka has no
  broker-side dead-letter queue, and the .DLT suffix is Spring Kafka's convention rather than
  Kafka's. There is no rate anywhere: the admin protocol reports none, so a produce or consume
  rate would have to be invented or read from JMX, which this app does not speak. And there is
  no disk percentage: Kafka reports the bytes its partitions occupy and nothing about the
  filesystem holding them, so there is no denominator to build one from.

- **Shipped** — Redis Stream 6.0+ over the Redis protocol itself, through go-redis. Streams
  with their length, memory and entry range; consumer groups with lag and every reposition
  XGROUP SETID offers; browsing entries by time window or by id, and writing them as the
  ordered field lists they are; the pending entries list with claim, auto-claim and
  acknowledge; the server's memory, persistence and slow log; its client connections; and ACL
  users with their key, channel and command rules. Standalone, sentinel and cluster all
  connect, and a cluster's streams are listed from every master rather than from the node that
  was dialled.

  The pending entries list stands in for the dead-letter page, because Redis moves nothing
  aside: an entry handed to a consumer stays in the stream and stays owed to that consumer
  until it is acknowledged or claimed away. No message rate and no disk figure are reported
  anywhere - Redis counts commands rather than messages, and reports memory rather than
  disk.

- **Shipped** — MQTT 3.1.1 and 5.0, over Paho's two Go libraries, which do not overlap: one
  speaks 3.1.1 and the other 5.0, and a broker configured for either refuses the other's
  CONNECT. The first family here with no administrative plane of its own, so what a connection
  can do is decided when it dials, in three tiers — the protocol, the $SYS tree most brokers
  publish, and the REST API EMQX and its peers add. Publishing with QoS, retain and the 5.0
  properties; a live subscribe workbench that reports what it dropped and when the session went
  down; topics from the retained set, which is the only thing MQTT can enumerate; broker
  counters from $SYS; and, where a management API answers, connected clients and their sessions,
  their subscriptions, the cluster's nodes, and disconnecting a session. A tier that does not
  answer is reported with its reason rather than leaving a page empty.

- **Designed, not yet implemented** — the ten families below.

## Delivery order

| Phase | Scope | Done when |
| --- | --- | --- |
| 0–3 | The driver seam itself: contracts, backend ports, storage and bridge, frontend registry | RocketMQ behaves exactly as before, screen for screen |
| 4 | **RabbitMQ** | Done. An Exchanges/Bindings page exists and no offset concept leaks into the UI |
| 5 | **Kafka** | Done. Topics, consumer groups, lag, browse and publish work end to end, alongside quotas, reassignment and transactions, and no rate or dead-letter page pretends to exist |
| 6 | **Redis Stream** | Done. Streams, groups, browse, publish, the pending entries list, the server and its cluster, clients and ACL users all read a real broker, and no maxlen or message rate pretends to exist. Additive as predicted, with four new ports: a log's trim, a subscription's position, an entry publish, and the pending list |
| 7 | **MQTT** | Done. The first family with no admin plane of its own: what it can do is probed at connect time in three tiers — the protocol, the $SYS tree, and the broker's own REST API — and a tier that does not answer says why rather than going quiet |
| 8 | **Pulsar**, then **NATS** | Each is purely additive — no canonical page changes shape |
| 9 | **ActiveMQ / Artemis**, then **NSQ** | Still additive; ActiveMQ tests whether JMS semantics fit the canonical pages |
| 10 | **Amazon SQS**, **Google Cloud Pub/Sub**, **Azure Service Bus**, **Amazon Kinesis**, then **IBM MQ** and **Solace PubSub+** | The connection form can express "no address, only a region and a credential" |

Two ordering decisions worth keeping in view.

**RabbitMQ came before Kafka on purpose.** Kafka is close enough to RocketMQ that it would
have passed even if the abstraction were wrong, so it could not validate anything. RabbitMQ
disagrees with RocketMQ about offsets, partitions and consumer groups, and that disagreement
was the real test.

Kafka then found the opposite kind of problem. Where RabbitMQ pushed on the canonical model,
Kafka pushed on the canonical model's *silences*: rates and disk percentages that every other
family reports and Kafka does not, and a dead-letter page the canonical page set assumes. The
answer in each case was to cut the column rather than to fill it in.

**The hosted tier changes the connection form, not just the driver.** Every family through
phase 7 is "an address plus optional credentials". The hosted tier is "a region plus a
credential, and no address at all" — the first connection where an empty `Endpoints` is
still valid. Whether the schema-driven form can express that should be settled while the
page contract is being fixed, not in phase 8.

## Per-driver scope

What each driver talks to, which canonical pages it lights up, and what it cannot offer.
The canonical pages are `Destinations`, `Subscriptions`, `Messages`, `Publish`, `Cluster`
and `Access`.

> Everything below RabbitMQ is a scope estimate read off each product's published
> management API. It is planning input, not verified behaviour — each row is confirmed
> when its driver is built.

### Self-hosted

| Driver | Management plane | Pages it lights up | Notable gaps |
| --- | --- | --- | --- |
| **RocketMQ** 4.x / 5.x | Admin API over the remoting protocol | All six | A Proxy endpoint answers far less than a NameServer; capabilities narrow on connect |
| **RabbitMQ** | HTTP management plugin, plus AMQP 0-9-1 for messages | All six, plus Exchanges/Bindings, Connections, Dead letters, Virtual hosts, Policies, Definitions, Replication | No offsets or partitions; no named consumer groups; no stable message id; browsing requeues what it read and carries a caveat; shovel, federation and the stream protocol are plugins and degrade with a reason when absent |
| **Kafka** | The Kafka protocol itself, through franz-go and kadm | All six, plus log directories and SCRAM users | Confirmed: browse is an offset-range fetch rather than random access, and a key search is a scan. ACLs degrade with a reason on a cluster with no authorizer. No rate of any kind is reported, and no disk percentage exists; there is no broker-side dead-letter queue |
| **Pulsar** | Admin REST API | All six | Tenant and namespace become a scope selector rather than a page |
| **ActiveMQ / Artemis** | Jolokia REST over JMX | All six | Classic 5.x and Artemis expose different management trees; the driver probes which one answered |
| **Redis Stream** | The Redis protocol itself, through go-redis | All six, plus Pending entries, Clients and ACL users | Confirmed: no per-destination access control - the key patterns are on the user. The prediction that there would be no cluster topology was wrong: `CLUSTER NODES` answers it, and the driver reads every master and replica. A stream has no partitions, nothing about it is editable, and there is no dead-letter queue - what replaces it is the pending entries list, which is delivery records rather than messages. No message rate and no disk figure are reported anywhere |
| **NATS** | JetStream API plus the server monitoring endpoints | Destinations, Subscriptions, Messages, Publish, Cluster | Without JetStream the endpoint drops to publish and subscribe only |
| **NSQ** | nsqd and nsqlookupd HTTP APIs | Destinations, Subscriptions, Publish, Cluster | No message history, so no browse |
| **MQTT** | None in the protocol. Probed at connect time: the $SYS tree, and the broker's own REST API where it has one | Overview, Topics, Subscribe, Publish, Clients, Cluster, Alerts | No consumer groups, no offsets and no stored history — a message exists while it is in flight and is gone if nobody was subscribed. Topics are those holding a retained value, because nothing else is enumerable. Clients need a management API, which Mosquitto does not have |

### Hosted

| Driver | Management plane | Pages it lights up | Notable gaps |
| --- | --- | --- | --- |
| **Amazon SQS** | SQS API | Destinations, Messages, Publish | No consumer groups and no cluster; receiving starts a visibility timeout, so browsing carries a caveat |
| **Google Cloud Pub/Sub** | Publisher and Subscriber admin APIs | Destinations, Subscriptions, Publish | Subscriptions are real objects and backlog maps cleanly to lag; pulling consumes, so browse needs a snapshot or a caveat |
| **Azure Service Bus** | Service Bus management API | Destinations, Subscriptions, Messages, Publish, plus rules on the routing page | No cluster; peek is non-destructive, so browse needs no caveat |
| **Amazon Kinesis** | Kinesis API | Destinations, Subscriptions, Messages, Publish | No cluster; shards are not partitions and need their own column set |

### Enterprise

| Driver | Management plane | Pages it lights up | Notable gaps |
| --- | --- | --- | --- |
| **IBM MQ** | Administrative REST API | All six | Channels are first-class with no canonical equivalent and are the likely override |
| **Solace PubSub+** | SEMP v2 | All six | Message VPN becomes a scope selector, as namespace does for Pulsar |

## Covered by an existing driver

Wire-compatible systems do not get a driver of their own. They connect through the driver
for the protocol they speak, and that driver narrows its capabilities on connect to what
the endpoint actually answers.

| Connect as | Systems |
| --- | --- |
| Kafka | Redpanda, AutoMQ, WarpStream, Confluent, Amazon MSK, Azure Event Hubs |
| MQTT | EMQX, Mosquitto, HiveMQ, VerneMQ |
| ActiveMQ or RabbitMQ | Amazon MQ |
| RocketMQ | Alibaba Cloud and Tencent Cloud RocketMQ |

## Out of scope

- **ZeroMQ, nanomsg** — no broker, and therefore no management plane to show.
- **Celery, Sidekiq, BullMQ** — application-level job queues layered on Redis or RabbitMQ.
  Inspecting them is a different product, not another driver.

## Beyond drivers

- Restore end-to-end UI coverage. The Playwright suite drove Electron through its CDP
  endpoint and was removed with it; the platform WebViews offer no equivalent on macOS.
  Options worth evaluating: driving the Linux WebKitGTK build in CI, or covering the same
  flows as Go integration tests against the `tests/e2e/rocketmq` environment.
- Dedicated UI for update download progress
- Broader RocketMQ 5.x Proxy and ACL management features

## Release history

### v0.1.0

Versioning restarts below 1.0 with the Wails 3 rewrite: the earlier 1.x line was built on a
different architecture and is no longer published.

- Migrate from Electron + local Go daemon back to Wails 3
- Replace the loopback HTTP transport with in-process Wails bindings
- Keep RocketMQ features, local settings, and encryption format compatible
- Ship macOS, Windows, and Linux packages
- Keep sensitive-field redaction in the bridge layer
