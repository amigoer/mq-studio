import type { ProtocolId } from "./protocols";

/** The six sample connections drawn in board 8a, in list order. */
export type ConnectionStatus = "online" | "offline" | "failed";

export type Connection = {
  key: string;
  name: string;
  protocol: ProtocolId;
  /** Protocol label as printed in the 8a "协议" column. */
  protocolLabel: string;
  address: string;
  env: string;
  status: ConnectionStatus;
  latency?: string;
  lastUsed: string;
  isDefault?: boolean;
  /** Subtitle fragment used by each page's `hd3` header. */
  subtitle: string;
};

export const CONNECTIONS: Connection[] = [
  {
    key: "rocketmq-order",
    name: "rocketmq-order",
    protocol: "rocketmq",
    protocolLabel: "RocketMQ 5.x",
    address: "10.12.3.44:9876 +1",
    env: "生产",
    status: "online",
    latency: "12ms",
    lastUsed: "刚刚",
    isDefault: true,
    subtitle: "rocketmq-order · RocketMQ 5.1.4 · NameServer 10.12.3.44:9876",
  },
  {
    key: "prod-kafka-cn",
    name: "prod-kafka-cn",
    protocol: "kafka",
    protocolLabel: "Kafka",
    address: "kafka-1:9092 +2 · SASL_SSL",
    env: "生产",
    status: "online",
    latency: "8ms",
    lastUsed: "5 分钟前",
    subtitle: "prod-kafka-cn · Kafka 3.7 · Controller kafka-1 · 自动刷新 10s",
  },
  {
    key: "rabbit-staging",
    name: "rabbit-staging",
    protocol: "rabbitmq",
    protocolLabel: "RabbitMQ",
    address: "rabbit.stg:5672 · /order",
    env: "测试",
    status: "online",
    latency: "24ms",
    lastUsed: "昨天",
    subtitle: "rabbit-staging · RabbitMQ 3.13 · vhost /order · 管理 API 已连接",
  },
  {
    key: "pulsar-eu",
    name: "pulsar-eu",
    protocol: "pulsar",
    protocolLabel: "Pulsar",
    address: "pulsar://pulsar-eu:6650 · ecommerce/orders",
    env: "生产",
    status: "offline",
    lastUsed: "3 天前",
    subtitle: "pulsar-eu · Pulsar 3.2 · ecommerce / orders",
  },
  {
    key: "redis-stream-01",
    name: "redis-stream-01",
    protocol: "redis",
    protocolLabel: "Redis Stream",
    address: "redis://10.2.0.8:6379/0",
    env: "生产",
    status: "failed",
    lastUsed: "1 周前",
    subtitle: "redis-stream-01 · Redis 7.2 · db0 · 单机",
  },
  {
    key: "iot-broker",
    name: "iot-broker",
    protocol: "mqtt",
    protocolLabel: "MQTT 5.0",
    address: "mqtts://iot.example.com:8883",
    env: "生产",
    status: "online",
    latency: "31ms",
    lastUsed: "今天",
    subtitle: "iot-broker · MQTT 5.0 · mqtts://iot.example.com:8883",
  },
];

export function connectionOf(key: string): Connection {
  const found = CONNECTIONS.find((c) => c.key === key);
  if (!found) throw new Error(`unknown connection: ${key}`);
  return found;
}

/** Tabs open on first paint — the four drawn in every screen board. */
export const DEFAULT_OPEN_TABS = [
  "rocketmq-order",
  "prod-kafka-cn",
  "rabbit-staging",
  "iot-broker",
];
