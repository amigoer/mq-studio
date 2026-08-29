import type { JSX } from "react";
import type { PageId, ProtocolId } from "@/design/data/protocols";
import { PROTOCOLS, labelOf } from "@/design/data/protocols";

import { OverviewRocketMQ } from "./boards/overview/OverviewRocketMQ";
import { OverviewKafka } from "./boards/overview/OverviewKafka";
import { OverviewRabbitMQ } from "./boards/overview/OverviewRabbitMQ";
import { OverviewPulsar } from "./boards/overview/OverviewPulsar";
import { OverviewRedis } from "./boards/overview/OverviewRedis";
import { OverviewMqtt } from "./boards/overview/OverviewMqtt";

import { TopicsRocketMQ } from "./boards/topics/TopicsRocketMQ";
import { TopicsKafka } from "./boards/topics/TopicsKafka";
import { QueuesRabbitMQ } from "./boards/topics/QueuesRabbitMQ";
import { ExchangesRabbitMQ } from "./boards/topics/ExchangesRabbitMQ";
import { TopicsPulsar } from "./boards/topics/TopicsPulsar";
import { StreamsRedis } from "./boards/topics/StreamsRedis";

import { ConsumersRocketMQ } from "./boards/consumers/ConsumersRocketMQ";
import { ConsumersKafka } from "./boards/consumers/ConsumersKafka";
import { SubscriptionsPulsar } from "./boards/consumers/SubscriptionsPulsar";
import { ConsumersRedis } from "./boards/consumers/ConsumersRedis";
import { ClientsMqtt } from "./boards/consumers/ClientsMqtt";
import { ChannelsRabbitMQ } from "./boards/consumers/ChannelsRabbitMQ";

import { MessagesRocketMQ } from "./boards/messages/MessagesRocketMQ";
import { MessagesKafka } from "./boards/messages/MessagesKafka";
import { MessagesRabbitMQ } from "./boards/messages/MessagesRabbitMQ";
import { MessagesPulsar } from "./boards/messages/MessagesPulsar";
import { MessagesRedis } from "./boards/messages/MessagesRedis";

import { DlqRocketMQ } from "./boards/dlq/DlqRocketMQ";
import { DlqKafka } from "./boards/dlq/DlqKafka";
import { DlqRabbitMQ } from "./boards/dlq/DlqRabbitMQ";
import { DlqPulsar } from "./boards/dlq/DlqPulsar";
import { PelRedis } from "./boards/dlq/PelRedis";

import { Producer } from "./boards/producer/Producer";

import { ClusterRocketMQ } from "./boards/cluster/ClusterRocketMQ";
import { BrokersKafka } from "./boards/cluster/BrokersKafka";
import { NodesRabbitMQ } from "./boards/cluster/NodesRabbitMQ";
import { BrokersPulsar } from "./boards/cluster/BrokersPulsar";
import { NodeRedis } from "./boards/cluster/NodeRedis";

import { MqttWorkbench } from "./boards/mqtt/MqttWorkbench";
import { NotDesigned } from "./boards/misc/NotDesigned";

/**
 * (page, protocol) -> board. Every cell is its own component: the canvas draws
 * each protocol's page separately and the differences are semantic, not
 * cosmetic, so nothing is shared beyond the primitive layer.
 */
const BOARDS: Partial<Record<PageId, Partial<Record<ProtocolId, () => JSX.Element>>>> = {
  overview: {
    rocketmq: OverviewRocketMQ,
    kafka: OverviewKafka,
    rabbitmq: OverviewRabbitMQ,
    pulsar: OverviewPulsar,
    redis: OverviewRedis,
    mqtt: OverviewMqtt,
  },
  topics: {
    rocketmq: TopicsRocketMQ,
    kafka: TopicsKafka,
    rabbitmq: QueuesRabbitMQ,
    pulsar: TopicsPulsar,
    redis: StreamsRedis,
    // MQTT's topic tree only exists inside the 4b workbench.
    mqtt: MqttWorkbench,
  },
  exchanges: { rabbitmq: ExchangesRabbitMQ },
  consumers: {
    rocketmq: ConsumersRocketMQ,
    kafka: ConsumersKafka,
    rabbitmq: ChannelsRabbitMQ,
    pulsar: SubscriptionsPulsar,
    redis: ConsumersRedis,
  },
  subscribe: { mqtt: MqttWorkbench },
  clients: { mqtt: ClientsMqtt },
  messages: {
    rocketmq: MessagesRocketMQ,
    kafka: MessagesKafka,
    rabbitmq: MessagesRabbitMQ,
    pulsar: MessagesPulsar,
    redis: MessagesRedis,
  },
  dlq: {
    rocketmq: DlqRocketMQ,
    kafka: DlqKafka,
    rabbitmq: DlqRabbitMQ,
    pulsar: DlqPulsar,
    redis: PelRedis,
  },
  cluster: {
    rocketmq: ClusterRocketMQ,
    kafka: BrokersKafka,
    rabbitmq: NodesRabbitMQ,
    pulsar: BrokersPulsar,
    redis: NodeRedis,
  },
};

export function renderBoard(protocol: ProtocolId, page: PageId): JSX.Element {
  if (page === "producer") return <Producer protocol={protocol} />;

  const Board = BOARDS[page]?.[protocol];
  if (Board) return <Board />;

  return (
    <NotDesigned labelKey={labelOf(protocol, page)} protocolName={PROTOCOLS[protocol].name} />
  );
}
