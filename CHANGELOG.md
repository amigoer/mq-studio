# Changelog

All notable changes to MQ Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[简体中文](CHANGELOG.zh-CN.md)

## [Unreleased]

## [0.0.2] - 2026-08-31

RabbitMQ support. The whole management plane, with messages carried over AMQP
rather than the management API's publish and get endpoints, so a send waits for
a publisher confirm and a browse behaves like a real consumer.

### Added

**RabbitMQ 3.x and 4.x**

- Connect to a broker's HTTP management plugin, with the AMQP data plane dialled
  alongside it. The connection identifies itself on the broker as
  `mq-studio: <name>`, so an operator can see which client is which.
- Overview, queues, exchanges and bindings, connections and channels, messages,
  dead letters, a send console, and nodes.
- Queues with their full arguments: classic, quorum and stream, durability,
  TTL, max length and overflow, dead-letter exchange and routing key, single
  active consumer. Declare, purge, move between queues, and delete.
- Exchanges and bindings: all four types plus alternate exchange, and bindings
  with their routing key and arguments, including a headers exchange's
  `x-match`.
- Browse over AMQP rather than the management API, filtered by routing key or
  header. The queue is left as it was found, and the page says what a browse
  costs: what it read comes back flagged redelivered.
- Publish with confirms: target exchange and routing key, mandatory,
  persistent, priority, expiration, headers, correlation id, reply-to and
  content type. A message nothing is bound to route is reported as unroutable
  rather than as a success.
- Dead letters read from the `x-death` header: which queue the message came
  from, why it was rejected, how many times, and when. Republish one or many
  back to their original queue or somewhere else, or drop them.
- Connections and channels with protocol, heartbeat, prefetch, unacknowledged
  count and flow-control state, and closing one with a reason.
- Nodes with their memory breakdown, resource alarms, partitions, the broker's
  own health checks, feature flags, and which deprecated features are actually
  in use.
- Virtual hosts: create, edit and delete, default queue type, deletion
  protection, tracing, and the connection and queue limits.
- Users and permissions: users and tags, the configure/write/read regex triple
  per virtual host, topic permissions, and per-user limits. Editing a user's
  tags no longer needs their password.
- Policies and operator policies with priority, pattern and definition, plus
  which policy a given queue actually matched; runtime and global parameters
  alongside them.
- Definitions: export the whole broker or one virtual host to a file, and
  import one after seeing what it will create.
- Shovels and federation: what exists, whether it is running, and the broker's
  own sentence when it is not. Read and delete only - a definition carries
  another broker's credentials, which are stripped before they leave the
  driver.
- Stream queues report the clients attached over the stream protocol, which
  never appear among a queue's AMQP consumers.
- Alerts derived from RabbitMQ's own figures: its resource alarms, network
  partitions, the approach to either watermark, a queue with a backlog, a queue
  with nobody reading it, and connections the broker is throttling.

### Fixed

- Alert rules read RocketMQ's attribute keys against every connection, so a
  RabbitMQ broker was measured for figures it never reports and raised nothing
  however badly it was doing.
- Management requests ignored the request timeout configured on the connection,
  because the underlying library takes no context. A slow broker could hold a
  page open indefinitely.
- A wrong password was reported as "enable the management plugin", sending the
  reader off to reconfigure a broker that was fine.
- Saving a connection kept only RocketMQ's access key pair and dropped every
  other credential, filing the connection as anonymous. Nothing could reach it
  in 0.0.1, where RocketMQ was the only driver, but it made a RabbitMQ
  connection impossible to save - and the form's test button passed, because it
  probes what was submitted rather than what was stored.

### Known limitations

- Kafka, Pulsar, NATS, MQTT and the rest appear in the interface and are
  disabled.
- Shovel, federation and the stream protocol are RabbitMQ plugins. A broker
  without them keeps the page, disabled, with the reason on it.
- macOS builds are not signed by a registered Apple developer. The disk image
  carries a First Run helper that clears the quarantine flag.

## [0.0.1] - 2026-08-31

First release of MQ Studio as a rebuilt project. MQ Studio is a desktop client
for message brokers, organised around a driver port so that support for a
broker family is one implementation behind a shared interface, rather than
assumptions spread through every page.

This release ships RocketMQ support only. The other protocols appear in the
interface and are disabled.

### Added

**Architecture**

- A driver port: a broker family is a driver behind one interface, with the
  services and the bridge above it agnostic to which family answered.
- A capability model: each connection reports what its endpoint can actually
  do, and the interface is drawn from that. A page the endpoint cannot serve is
  disabled with the reason; one the family has no concept of is not drawn.
- Multiple connections open at once, each in its own tab with its own pages,
  every request naming the connection it runs against.

**RocketMQ 4.x and 5.x**

- Overview, topics, consumer groups, message search, dead letters, publishing
  and cluster health, read from a live NameServer.
- Topic and consumer group operations: create, edit and delete topics; reset a
  group's read position by time; clone one group's positions onto another;
  write a single queue's offset.
- Message operations: query by key, tag, time window or message id; follow a
  topic live; trace where a message got to; resend a dead letter; hand one
  message to a named consumer and read back what its handler returned.
- Cluster operations: read a broker's and the name servers' effective settings,
  see how far replicas trail, run housekeeping on demand, take a broker out of
  the write path to drain it.
- Access control: RocketMQ 5.3 users and rules, readable and writable, with 4.x
  plain_acl kept as a write-only fallback that says so on the page.
- Alerts: broker offline, group offline, backlog, disk water level and dead
  letters, evaluated across every open connection, surfaced in the title bar
  and on a page of their own, with optional desktop notifications.

**Platforms**

- macOS on Apple Silicon and Intel, Windows on x64 and ARM64, and Linux on x64
  and ARM64 as .deb, .rpm and AppImage.

### Known limitations

- RocketMQ is the only broker that can be connected. The RabbitMQ driver is
  written but its pages are not built yet.
- Four operations are held back by defects in the RocketMQ admin library this
  application is built on, most visibly consumer group creation and editing.
  Each is pinned by a test asserting the current behaviour, so fixing the
  library is what unblocks them.
- macOS builds are not signed by a registered Apple developer. The disk image
  carries a First Run helper that clears the quarantine flag.

### Notes

- Version numbering starts over here. The 0.1.x builds predate the rebuild and
  have been removed.
