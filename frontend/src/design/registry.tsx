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
import { VhostsRabbitMQ } from "./boards/vhosts/VhostsRabbitMQ";
import { UsersRabbitMQ } from "./boards/acl/UsersRabbitMQ";
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
import { ProducerRabbitMQ } from "./boards/producer/ProducerRabbitMQ";
import { Alerts } from "./boards/alerts/Alerts";
import { Acl } from "./boards/acl/Acl";

import { ClusterRocketMQ } from "./boards/cluster/ClusterRocketMQ";
import { BrokersKafka } from "./boards/cluster/BrokersKafka";
import { NodesRabbitMQ } from "./boards/cluster/NodesRabbitMQ";
import { BrokersPulsar } from "./boards/cluster/BrokersPulsar";
import { NodeRedis } from "./boards/cluster/NodeRedis";

import { MqttWorkbench } from "./boards/mqtt/MqttWorkbench";
import { NotDesigned } from "./boards/misc/NotDesigned";

/**
 * What one page should arrive looking at, when it was reached from another.
 *
 * A board reads it once, on mount, so a later edit by the user is never
 * overwritten by where they came from.
 */
export interface BoardFocus {
  topic?: string;
  group?: string;
  /** Open the page's create dialog on arrival. */
  create?: boolean;
}

/** What a board may ask the shell to do, for the few that need to. */
export interface BoardNav {
  /** The alerts page sends the reader to where the thresholds are set. */
  onOpenAlertSettings?: () => void;
  /** Move to another page in this tab, optionally naming what to open on. */
  onOpenPage?: (page: PageId, focus?: BoardFocus) => void;
  /** Set when this page was reached through `onOpenPage`. */
  focus?: BoardFocus;
}

export interface BoardProps {
  nav?: BoardNav;
}

/**
 * (page, protocol) -> board. Every cell is its own component: the canvas draws
 * each protocol's page separately and the differences are semantic, not
 * cosmetic, so nothing is shared beyond the primitive layer.
 */
const BOARDS: Partial<
  Record<PageId, Partial<Record<ProtocolId, (props: BoardProps) => JSX.Element>>>
> = {
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
  vhosts: { rabbitmq: VhostsRabbitMQ },
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

export function renderBoard(
  protocol: ProtocolId,
  page: PageId,
  nav?: BoardNav,
): JSX.Element {
  /* The send console is per family, not shared: RabbitMQ's collects an
     exchange, a routing key, headers and AMQP properties, and the shared one
     collects a topic, tags, keys and a delay level - RocketMQ's vocabulary, of
     which only the body means anything here. */
  if (page === "producer") {
    if (protocol === "rabbitmq") return <ProducerRabbitMQ />;
    return <Producer protocol={protocol} nav={nav} />;
  }
  /* Alerts is one board for every family: the rules are numeric comparisons
     over a cluster snapshot, with nothing protocol-specific to draw. */
  if (page === "alerts") return <Alerts onOpenSettings={nav?.onOpenAlertSettings} />;
  /* Access control is per family, and deliberately so: each speaks its own
     model. RocketMQ has a credential pair carrying its own permissions;
     RabbitMQ has users whose tags gate the management API and whose
     per-virtual-host permissions gate AMQP, which are two systems on one name. */
  if (page === "acl") {
    if (protocol === "rocketmq") return <Acl />;
    if (protocol === "rabbitmq") return <UsersRabbitMQ />;
  }

  const Board = BOARDS[page]?.[protocol];
  if (Board) return <Board nav={nav} />;

  return (
    <NotDesigned labelKey={labelOf(protocol, page)} protocolName={PROTOCOLS[protocol].name} />
  );
}
