# Changelog

All notable changes to MQ Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[简体中文](CHANGELOG.zh-CN.md)

## [Unreleased]

The application was rebuilt around a driver port, so this is not a list of
changes to 0.1.3 — it is what the rebuilt app does. The 0.1.x releases predate
it and have been removed; the first release from this line takes a new number.

### Added

- **Multiple connections at once.** Each connection opens in its own tab with
  its own pages, and every request names the connection it runs against.
- **RocketMQ, end to end.** Overview, topics, consumer groups, message search,
  dead letters, publishing and cluster health, all reading a live NameServer.
- **Topic and consumer group operations.** Create, edit and delete topics; reset
  a group's read position by time; copy one group's positions onto another;
  write a single queue's offset directly.
- **Message operations.** Query by key, tag, time window or message id; follow
  a topic live; trace where a message got to; resend a dead letter; hand one
  message back to a named consumer and see what its handler returned.
- **Cluster operations.** Read a broker's and the name servers' effective
  settings, see how far a broker's replicas trail it, run a broker's
  housekeeping on demand, and take a broker out of the write path to drain it.
- **Access control.** RocketMQ 5.3 users and rules, readable and writable, with
  4.x plain_acl kept as a write-only fallback that says so.
- **Alerts.** Broker offline, group offline, backlog, disk water level and dead
  letters, evaluated across every open connection, surfaced in the title bar
  and on a page of their own, with optional desktop notifications.
- **A capability layer.** Each connection reports what its endpoint can do, and
  the navigation is drawn from that: a page the endpoint cannot serve is
  disabled with the reason, one the family has no concept of is not drawn.

### Notes

- Only RocketMQ can be connected. The other protocol tiles are drawn and
  disabled; the RabbitMQ driver exists but its pages are not wired yet.
- Six operations are held back by defects in `rocketmq-admin-go`, the admin
  library this app is built on — most visibly consumer group creation and
  editing. Each is pinned by a test that asserts the current behaviour, so
  fixing the library is what unblocks them.

