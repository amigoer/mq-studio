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

- **Designed, not yet implemented** — the twelve families below.

## Delivery order

| Phase | Scope | Done when |
| --- | --- | --- |
| 0–3 | The driver seam itself: contracts, backend ports, storage and bridge, frontend registry | RocketMQ behaves exactly as before, screen for screen |
| 4 | **RabbitMQ** | Done. An Exchanges/Bindings page exists and no offset concept leaks into the UI |
| 5 | **Kafka** | Done. Topics, consumer groups, lag, browse and publish work end to end, alongside quotas, reassignment and transactions, and no rate or dead-letter page pretends to exist |
| 6 | **Pulsar** | Done. Topics, namespaces and the tenants above them, subscriptions and cursors, browse and tail, a send console, dead letters and role grants all work end to end, and no page pretends to a tag, a disk figure or a user directory this family does not have |
| 7 | **Redis Stream**, then **NATS**, then **MQTT** | Each is purely additive — no canonical page changes shape |
| 8 | **ActiveMQ / Artemis**, then **NSQ** | Still additive; ActiveMQ tests whether JMS semantics fit the canonical pages |
| 9 | **Amazon SQS**, **Google Cloud Pub/Sub**, **Azure Service Bus**, **Amazon Kinesis**, then **IBM MQ** and **Solace PubSub+** | The connection form can express "no address, only a region and a credential" |

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
| **Pulsar** | Admin REST API + the binary protocol | All six | Done. The tenant and namespace ended up as both: a scope selector on every page, and a page of their own, because a topic is addressed as tenant/namespace/name and the selector needs somewhere to get its options from |
| **ActiveMQ / Artemis** | Jolokia REST over JMX | All six | Classic 5.x and Artemis expose different management trees; the driver probes which one answered |
| **Redis Stream** | `XINFO`, `XRANGE`, `XADD` | Destinations, Subscriptions, Messages, Publish | No cluster topology and no per-destination access control |
| **NATS** | JetStream API plus the server monitoring endpoints | Destinations, Subscriptions, Messages, Publish, Cluster | Without JetStream the endpoint drops to publish and subscribe only |
| **NSQ** | nsqd and nsqlookupd HTTP APIs | Destinations, Subscriptions, Publish, Cluster | No message history, so no browse |
| **MQTT** | None — the protocol has no admin plane | Publish, plus a live Subscribe page | Everything else. EMQX, HiveMQ and their peers expose their own REST management, which the driver can probe and light up at runtime |

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
