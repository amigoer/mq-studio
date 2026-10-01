# Driver support

[简体中文](DRIVERS.zh-CN.md)

MQ Studio reaches every broker through a pluggable driver. Each driver declares what its family
can do, so the interface only offers what the connected broker can actually do. ACL and some
advanced operations still depend on the broker version and configuration; the capability model
behind this page is described in [the multi-MQ design](MULTI_MQ_DESIGN.md).

## RocketMQ 4.x / 5.x

The first driver and still the deepest, reached through the Admin API over the remoting
protocol with a NameServer address - a 5.x Proxy endpoint is refused rather than dialled,
because it answers no route, topology or ACL request. Topics with their queues, permissions and
message type; creating, editing and deleting them. Consumer groups with their lag queue by
queue, the clients connected to each, and offsets reset to a point in time or cloned from
another group. Messages found by key, tag, id or time window, followed live, sent with a delay,
resent or handed straight to one consumer group, and traced through the groups that have and
have not consumed them. Dead letters and retry topics, group by group. The cluster's brokers
with their throughput, disk and effective settings, and write permission switched per broker.
Producer groups inspected by name. ACL users and their permissions on the 5.x auth model, and
namespaces kept apart on the client side.

## RabbitMQ 3.x / 4.x

Full management plane: queues, exchanges and bindings, connections and channels, browse and publish over AMQP, dead letters, virtual hosts, users and permissions, policies, definitions, shovels and federation

## Kafka 3.x / 4.x

Topics with their partitions, replicas and settings; consumer groups with per-partition lag and every offset reset Kafka offers; browsing and following a log; producing with keys, headers and an acknowledgement level; brokers, their effective settings and their log directories; ACLs and SCRAM users; client quotas; partition reassignment and preferred-leader election; and the cluster's open transactions

## Pulsar 3.x / 4.x

Topics with their partitions and storage kind; namespaces and the tenants above them, with TTL, retention and per-topic limits; subscriptions with backlog, delayed and unacknowledged counts, blocked-subscription detection, and cursor moves by time or to the earliest message; browsing and following a log without taking a subscription; sending with keys, ordering keys, properties and delayed delivery; brokers with their bundles and resource usage; dead-letter and retry topics found by the client libraries' naming convention; and role grants on namespaces and topics

## Redis Stream 6.0+

Streams with their length, memory and entry range; consumer groups with lag and every reposition XGROUP SETID offers; browsing entries by time window or id, and writing them as ordered fields; the pending entries list with claim, auto-claim and acknowledge; the server's memory, persistence and slow log; standalone, sentinel and cluster; client connections; and ACL users with their key, channel and command rules

## MQTT 3.1.1 / 5.0

Publish with QoS, retain and the 5.0 properties; a live subscribe workbench that reports what it dropped and when the session went down; topics from the broker's retained set; the $SYS tree where a broker publishes one; and — where the broker offers a management API, as EMQX and its peers do — connected clients and their sessions, their subscriptions, the cluster's nodes, and disconnecting a session. Mosquitto, EMQX, HiveMQ and VerneMQ

## NATS 2.x

JetStream streams with their subjects, retention, storage and replica set; consumers push and pull, with pending, unacknowledged and redelivered counts; browsing and following a stream by sequence; publishing on a subject, with a request that waits for a reply; a subjects workbench for core NATS, which stores nothing and delivers only to whoever is listening; purge by count, sequence or subject and deleting single messages; the cluster's servers with their routes and effective settings, read through $SYS or the monitoring endpoint; client connections with what each is subscribed to, and disconnecting one; and the accounts, with their JetStream usage against the caps they were given

## ActiveMQ Classic 5.x / 6.x · Artemis 2.x

One family, two brokers, told apart when the connection opens. Queues and topics with their depth, counters and settings; durable subscriptions on either product, created and removed; browsing that takes nothing off the destination, because it is a management operation on both; sending with JMS headers, properties and a priority; dead letters found by walking the declarations backwards, and retried back to the destinations they failed on; the broker with its store, journal and effective settings, and the brokers it bridges to; client connections with the protocol each speaks, and disconnecting one; and — where the broker's AMQP acceptor is reachable — watching a topic as messages arrive

## NSQ 1.x

One family, no admin protocol: everything an operator can ask is an HTTP call on the daemons that carry the messages. Topics with the depth they hold, split between the topic's own queue and its channels', summed across every nsqd carrying them; channels, which are this family's consumer groups, with their backlog, in-flight and deferred counts; creating, emptying, pausing and deleting either, on every daemon at once and in the discovery tier as well; publishing to one named daemon, repeated or held back for a delivery time; the cluster's nsqd beside the nsqlookupd that tell consumers where they are, with a warning when the two disagree; and who is connected, in both roles nsqd reports them in: consumers with the ready count that says which of them has stopped asking for work, and producers with what each has published. No message browse and no dead letters: nsqd hands a message to a consumer and stops holding it

## Amazon SQS

The first family with no address to type: a connection is a region and an AWS credential, and the SDK resolves the rest. Queues with what they are holding split three ways — available, in flight and delayed, which are three different problems; creating, editing, purging and deleting them, standard or FIFO; browsing, which goes through ReceiveMessage and carries the caveat that says so; sending with named attributes, a delay, a repeat, and the group and deduplication ids a FIFO queue requires; and dead letters found by walking every queue's redrive policy backwards. No consumer groups and no cluster, because SQS has neither

## Google Pub/Sub

The second family with no address to type: a connection is a project and a Google credential. The first whose objects come in two kinds — a topic holds nothing and fans a publish out to whatever subscribes at that instant, so the topics board leads with a subscription count and a topic with none is the fault it marks. Subscriptions as objects in their own right, with the whole of the delivery configuration on them: ack deadline, retention, retry backoff, filters, ordering, and where they give up to; creating and deleting either; browsing a subscription, which goes through Pull and carries the caveat that says so; publishing with attributes and an ordering key; restore points, and moving a subscription to one or to a moment in time; and dead letters found by inverting every subscription's policy. No backlog figure, because that one lives in Cloud Monitoring

## Azure Service Bus

The third hosted family and the first of them reached by dialling something: a namespace is a real address, so this one has an endpoint field where SQS has a region and Pub/Sub a project. Queues and topics on one board, because they are the same thing to create, configure and delete — a queue holds its messages and a topic holds none, copying each send into the subscriptions whose rules let it through. Subscriptions with the whole delivery contract on them, and rules on the routing page: objects with names, several to a subscription, each a SQL or correlation filter and optionally an action that rewrites the message on the way in. Browsing is a peek, so it is the one messages page here with no caveat at all — nothing is taken, nothing is locked, no delivery count moves, and a scheduled or deferred message no consumer would be offered shows up anyway. Sending with a subject, properties, a session key and a real delay; and dead letters read from the $DeadLetterQueue every queue and subscription is created with, and put back one at a time

## Amazon Kinesis

The fourth hosted family, back to a region and an AWS credential with no address to type. The one family whose central object the canonical pages had no room for: a shard is not a partition number, so it gets a page of its own — every shard a stream has, open or closed, with the slice of the hash space that decides which records land on it, the parent it was split from or the two it was merged out of, and the closed ones kept in the listing because they still hold their records until retention expires. Streams with their open shard count, capacity mode and retention; creating, resizing and deleting them, provisioned or on demand. Browsing that takes nothing at all — no record is hidden, consumed or marked, and any number of readers can read the same one — carrying instead the caveat that it spends the shard's read allowance, which every consumer on that shard shares. Sending with the partition key that places a record and the explicit hash key that aims it at a shard by name. Registered fan-out consumers, which are the only readers a stream knows about. No backlog, because nothing anywhere in the service keeps a reader's position

## IBM MQ

The first enterprise family, and the second reached through a vendor's own HTTP management plane rather than a wire client — everything here goes over the two REST interfaces the mqweb server hosts, so no build of this app needs IBM's native client libraries. Channels get a page of their own, because nothing in the canonical vocabulary is shaped like one: a channel is a definition that exists with nothing connected, it is what decides whether an application may connect at all, and one of them carries a running instance per connected client. Queues and topics on one board, with the alias and remote definitions a message passes through on its way somewhere else; creating and deleting either. Browsing that genuinely takes nothing — the depth is the same afterwards — carrying instead the caveat that the server returns character data only, so a dead letter is listed and cannot be opened. Sending to a queue with the descriptor an MQ message actually carries. Subscriptions whose backlog is the depth of the queue they deliver to, and dead letters found by walking the queue manager's own DEADQ and every queue's backout queue backwards

## Solace PubSub+ 10.x

The second enterprise family and the last driver on the roadmap, reached entirely over SEMP v2 - plain HTTP with JSON, so no build of this app needs Solace's native client. A Message VPN is a scope rather than an address: one broker hosts many, every object lives inside one, and the sidebar re-points the whole connection at another without editing the profile. Queues with what they are actually holding, which is not the field that looks like it - spooledMsgCount is a lifetime statistic, so the depth is read from the message collection's own count; creating and deleting them, with the access type that decides whether one consumer takes everything or several share it. Routing gets a page, and this family has the strongest claim to one: a publisher never names a queue at all, so what has subscribed is the whole of what decides where a message lands - topic subscriptions added and removed on a queue, and topic endpoints whose name is their subscription. Browsing that takes nothing - the queue is byte-for-byte the same afterwards - carrying instead the caveat that SEMP returns no message payload at any version, so a message is listed with its sizes and delivery count and there is no body to open. Sending through the REST messaging interface on its own port, to a queue by name or to a topic to be matched, with the dead-message flag that decides whether a message given up on is moved or discarded. Dead messages found by inverting every endpoint's pointer - including the pointer every endpoint ships with, at a queue no broker creates, which is what makes an unconfigured Message VPN discard silently. The broker with its version and the spool this VPN is using, and who is connected

## Covered by an existing driver

Wire-compatible systems do not get a driver of their own: Redpanda, AutoMQ, WarpStream,
Confluent, Amazon MSK, and Azure Event Hubs connect as Kafka; EMQX, Mosquitto, HiveMQ, and
VerneMQ as MQTT; Amazon MQ as ActiveMQ or RabbitMQ; Alibaba Cloud and Tencent Cloud RocketMQ as
RocketMQ. Each driver declares what its family can do and the pages are drawn from that;
probing an endpoint to narrow it per deployment is not built yet.

## Out of scope

ZeroMQ and nanomsg have no broker and therefore no management plane. Celery, Sidekiq, and
BullMQ are application-level job queues layered on Redis or RabbitMQ rather than message
brokers.

## Asking for another

Every driver on the roadmap has landed, so a further one is a request rather than a plan. The
[driver request](https://github.com/amigoer/mq-studio/issues/new?template=5-driver-request.yml)
form asks the one question that decides whether one is possible at all: what the app can reach
from a desktop, and how.
