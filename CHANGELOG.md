# Changelog

All notable changes to MQ Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[简体中文](CHANGELOG.zh-CN.md)

## [Unreleased]

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
