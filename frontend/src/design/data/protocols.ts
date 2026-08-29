/**
 * Protocol registry for the design shell. The nav shape per protocol is taken
 * from the canvas sidebars (11a RocketMQ, 13a Kafka, 11b RabbitMQ, 11c Pulsar,
 * 11d Redis, 11e MQTT) — the same page slot is labelled with each protocol's
 * own noun, which is what makes the shell readable across six brokers.
 *
 * The canvas drew the icons as Unicode symbols, whose design sizes are
 * unrelated: ⌂ inked 5.5px wide where ⇄ inked 11px, and off darwin each fell
 * back to whatever the system had. lucide draws them on one grid instead. A
 * page slot carries the same icon across protocols even where the label does
 * not (topics is Topic / 队列 / Stream), because the slot is what the shell
 * navigates -- the exceptions are RabbitMQ's exchanges and MQTT's subscribe
 * and clients, which have no counterpart elsewhere.
 */
import {
  BellRing,
  House,
  Layers,
  Mail,
  Plug,
  Radio,
  Send,
  Server,
  Shield,
  TriangleAlert,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

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

export type NavEntry = { id: PageId; icon: LucideIcon; label: string };
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
      { items: [{ id: "overview", icon: House, label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: Layers, label: "Topic" },
          { id: "consumers", icon: Users, label: "消费者" },
          { id: "messages", icon: Mail, label: "消息" },
          { id: "dlq", icon: TriangleAlert, label: "死信 / 重试" },
          { id: "producer", icon: Send, label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: Server, label: "集群" },
          { id: "alerts", icon: BellRing, label: "告警" },
          { id: "acl", icon: Shield, label: "ACL" },
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
      { items: [{ id: "overview", icon: House, label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: Layers, label: "Topic" },
          { id: "consumers", icon: Users, label: "消费者组" },
          { id: "messages", icon: Mail, label: "消息" },
          { id: "dlq", icon: TriangleAlert, label: "死信 DLT" },
          { id: "producer", icon: Send, label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: Server, label: "Broker" },
          { id: "alerts", icon: BellRing, label: "告警" },
          { id: "acl", icon: Shield, label: "ACL" },
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
      { items: [{ id: "overview", icon: House, label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: Layers, label: "队列" },
          { id: "exchanges", icon: Waypoints, label: "交换机" },
          { id: "messages", icon: Mail, label: "消息" },
          { id: "dlq", icon: TriangleAlert, label: "死信 DLX" },
          { id: "producer", icon: Send, label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: Server, label: "节点" },
          { id: "alerts", icon: BellRing, label: "告警" },
          { id: "acl", icon: Shield, label: "用户 / vhost" },
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
      { items: [{ id: "overview", icon: House, label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: Layers, label: "Topic" },
          { id: "consumers", icon: Users, label: "订阅" },
          { id: "messages", icon: Mail, label: "消息" },
          { id: "dlq", icon: TriangleAlert, label: "死信 DLQ" },
          { id: "producer", icon: Send, label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: Server, label: "Broker / Bookie" },
          { id: "alerts", icon: BellRing, label: "告警" },
          { id: "acl", icon: Shield, label: "Token" },
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
      { items: [{ id: "overview", icon: House, label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: Layers, label: "Stream" },
          { id: "consumers", icon: Users, label: "消费者组" },
          { id: "messages", icon: Mail, label: "消息" },
          { id: "dlq", icon: TriangleAlert, label: "待确认 PEL" },
          { id: "producer", icon: Send, label: "生产者" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: Server, label: "节点" },
          { id: "alerts", icon: BellRing, label: "告警" },
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
      { items: [{ id: "overview", icon: House, label: "总览" }] },
      {
        label: BROWSE,
        items: [
          { id: "topics", icon: Layers, label: "主题" },
          { id: "subscribe", icon: Radio, label: "订阅监听" },
          { id: "producer", icon: Send, label: "发布" },
          { id: "clients", icon: Plug, label: "客户端 / 会话" },
        ],
      },
      {
        label: OPS,
        items: [
          { id: "cluster", icon: Server, label: "$SYS" },
          { id: "alerts", icon: BellRing, label: "告警" },
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
