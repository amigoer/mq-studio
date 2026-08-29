/**
 * Protocol registry for the design shell. The nav shape per protocol is taken
 * from the canvas sidebars (11a RocketMQ, 13a Kafka, 11b RabbitMQ, 11c Pulsar,
 * 11d Redis, 11e MQTT) — the same page slot is labelled with each protocol's
 * own noun, which is what makes the shell readable across six brokers.
 */

export type ProtocolId =
  | "rocketmq"
  | "kafka"
  | "rabbitmq"
  | "pulsar"
  | "redis"
  | "mqtt";

export type PageId =
  | "overview"
  | "topics"
  | "exchanges"
  | "consumers"
  | "messages"
  | "dlq"
  | "producer"
  | "subscribe"
  | "clients"
  | "cluster"
  | "alerts"
  | "acl";

export type NavEntry = { id: PageId; icon: string; label: string };
export type NavGroup = { label?: string; items: NavEntry[] };

export type Protocol = {
  id: ProtocolId;
  /** Display name used in connection rows and page subtitles. */
  name: string;
  /** Monospace badge from the 3h capability matrix. */
  badge: string;
  /** Badge palette class from tokens.css (`pb pRMQ` …). */
  badgeClass: string;
  nav: NavGroup[];
};

const BROWSE = "浏览";
const OPS = "运维";

export const PROTOCOLS: Record<ProtocolId, Protocol> = {
  rocketmq: {
    id: "rocketmq",
    name: "RocketMQ",
    badge: "RMQ 4/5",
    badgeClass: "pRMQ",
    nav: [
      { items: [{ id: "overview", icon: "⌂", label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: "▦", label: "Topic" },
          { id: "consumers", icon: "◎", label: "消费者" },
          { id: "messages", icon: "✉", label: "消息" },
          { id: "dlq", icon: "⚠", label: "死信 / 重试" },
          { id: "producer", icon: "➤", label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: "▣", label: "集群" },
          { id: "alerts", icon: "◔", label: "告警" },
          { id: "acl", icon: "✦", label: "ACL" },
        ],
      },
    ],
  },
  kafka: {
    id: "kafka",
    name: "Kafka",
    badge: "KAFKA",
    badgeClass: "pKFK",
    nav: [
      { items: [{ id: "overview", icon: "⌂", label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: "▦", label: "Topic" },
          { id: "consumers", icon: "◎", label: "消费者组" },
          { id: "messages", icon: "✉", label: "消息" },
          { id: "dlq", icon: "⚠", label: "死信 DLT" },
          { id: "producer", icon: "➤", label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: "▣", label: "Broker" },
          { id: "alerts", icon: "◔", label: "告警" },
          { id: "acl", icon: "✦", label: "ACL" },
        ],
      },
    ],
  },
  rabbitmq: {
    id: "rabbitmq",
    name: "RabbitMQ",
    badge: "RABBIT",
    badgeClass: "pAMQ",
    nav: [
      { items: [{ id: "overview", icon: "⌂", label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: "▦", label: "队列" },
          { id: "exchanges", icon: "⇄", label: "交换机" },
          { id: "messages", icon: "✉", label: "消息" },
          { id: "dlq", icon: "⚠", label: "死信 DLX" },
          { id: "producer", icon: "➤", label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: "▣", label: "节点" },
          { id: "alerts", icon: "◔", label: "告警" },
          { id: "acl", icon: "✦", label: "用户 / vhost" },
        ],
      },
    ],
  },
  pulsar: {
    id: "pulsar",
    name: "Pulsar",
    badge: "PULSAR",
    badgeClass: "pPLS",
    nav: [
      { items: [{ id: "overview", icon: "⌂", label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: "▦", label: "Topic" },
          { id: "consumers", icon: "◎", label: "订阅" },
          { id: "messages", icon: "✉", label: "消息" },
          { id: "dlq", icon: "⚠", label: "死信 DLQ" },
          { id: "producer", icon: "➤", label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: "▣", label: "Broker / Bookie" },
          { id: "alerts", icon: "◔", label: "告警" },
          { id: "acl", icon: "✦", label: "Token" },
        ],
      },
    ],
  },
  redis: {
    id: "redis",
    name: "Redis Stream",
    badge: "REDIS",
    badgeClass: "pRDS",
    nav: [
      { items: [{ id: "overview", icon: "⌂", label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: "▦", label: "Stream" },
          { id: "consumers", icon: "◎", label: "消费者组" },
          { id: "messages", icon: "✉", label: "消息" },
          { id: "dlq", icon: "⚠", label: "待确认 PEL" },
          { id: "producer", icon: "➤", label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: "▣", label: "节点" },
          { id: "alerts", icon: "◔", label: "告警" },
        ],
      },
    ],
  },
  mqtt: {
    id: "mqtt",
    name: "MQTT",
    badge: "MQTT",
    badgeClass: "pMQT",
    nav: [
      { items: [{ id: "overview", icon: "⌂", label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: "▦", label: "主题" },
          { id: "subscribe", icon: "◎", label: "订阅监听" },
          { id: "producer", icon: "➤", label: "发布" },
          { id: "clients", icon: "✦", label: "客户端 / 会话" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: "▣", label: "$SYS" },
          { id: "alerts", icon: "◔", label: "告警" },
        ],
      },
    ],
  },
};

export const PROTOCOL_ORDER: ProtocolId[] = [
  "rocketmq",
  "kafka",
  "rabbitmq",
  "pulsar",
  "redis",
  "mqtt",
];

/** Every page the protocol's sidebar can reach, flattened. */
export function pagesOf(protocol: ProtocolId): PageId[] {
  return PROTOCOLS[protocol].nav.flatMap((g) => g.items.map((i) => i.id));
}

export function labelOf(protocol: ProtocolId, page: PageId): string {
  for (const group of PROTOCOLS[protocol].nav) {
    for (const item of group.items) if (item.id === page) return item.label;
  }
  return page;
}
