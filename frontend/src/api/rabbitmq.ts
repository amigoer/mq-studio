/**
 * The RabbitMQ-only surface.
 *
 * Queues and consumers reach the pages through the canonical topic and
 * consumer APIs, because a queue is a destination and a consumer is a
 * subscription. What lands here is what has no counterpart in another family:
 * the broker's own running totals, and the virtual hosts, policies and
 * exchanges that come later.
 */
import { RabbitMQService } from "@bindings/bridge";
import type {
  BrokerCensus,
  BrokerHealth,
  ClientChannel,
  ClientConnection,
  DeadLetterQueue,
} from "@bindings/model/models";
import { present } from "./client";

export type {
  BrokerCensus,
  BrokerHealth,
  BrokerRates,
  ClientChannel,
  ClientConnection,
  DeadLetterQueue,
  DeadLetterSource,
  DeprecatedFeature,
  FeatureFlag,
  HealthCheck,
  ResourceAlarm,
} from "@bindings/model/models";

/**
 * The broker's running totals, or null when nothing is connected.
 *
 * Null rather than an error: the overview draws its own not-connected state,
 * and an error banner on top of it would say the same thing twice.
 */
export const getCensus = (connID: number): Promise<BrokerCensus | null> =>
  RabbitMQService.Census(connID);

/** The transport connections open against the broker, in one virtual host. */
export const getClientConnections = (
  connID: number,
  namespace = "",
): Promise<ClientConnection[]> =>
  RabbitMQService.ClientConnections(connID, namespace).then(present);

/** The channels multiplexed inside those connections. */
export const getClientChannels = (
  connID: number,
  namespace = "",
): Promise<ClientChannel[]> =>
  RabbitMQService.ClientChannels(connID, namespace).then(present);

/**
 * The broker's own health checks, resource alarms, feature flags and the
 * deprecated features it still allows.
 *
 * Null when nothing is connected.
 */
export const getHealth = (connID: number): Promise<BrokerHealth | null> =>
  RabbitMQService.Health(connID);

/** The queues dead letters land in, and what feeds each one. */
export const getDeadLetterQueues = (
  connID: number,
  namespace = "",
): Promise<DeadLetterQueue[]> =>
  RabbitMQService.DeadLetterQueues(connID, namespace).then(present);

export interface QueueDeclaration {
  vhost: string;
  name: string;
  queueType: string;
  durable: boolean;
  autoDelete: boolean;
  /** The declaration arguments as JSON, so a number stays a number. */
  arguments: string;
}

/** Declares a queue. Re-declaring with different arguments is an error. */
export const declareQueue = (connID: number, queue: QueueDeclaration): Promise<void> =>
  RabbitMQService.DeclareQueue(connID, queue);

/**
 * Deletes a queue and everything in it.
 *
 * The two guards are the broker's own preconditions, checked where the delete
 * happens - which is the only place they can be checked without a race.
 */
export const deleteQueue = (
  connID: number,
  vhost: string,
  name: string,
  guards: { ifUnused?: boolean; ifEmpty?: boolean } = {},
): Promise<void> =>
  RabbitMQService.DeleteQueue(connID, vhost, name, guards.ifUnused ?? false, guards.ifEmpty ?? false);

/** Drops everything a queue is holding. There is no undo. */
export const purgeQueue = (connID: number, vhost: string, name: string): Promise<void> =>
  RabbitMQService.PurgeQueue(connID, vhost, name);

export interface MoveRequest {
  vhost: string;
  from: string;
  /** Empty is the default exchange, which routes by queue name. */
  toExchange: string;
  /** Empty means each message keeps its own routing key. */
  toRoutingKey: string;
  limit: number;
}

/**
 * Drains a queue into an exchange and reports how many arrived.
 *
 * The count is meaningful even when this rejects: that many already moved, and
 * the page has to say so rather than implying nothing happened.
 */
export const moveMessages = (connID: number, request: MoveRequest): Promise<number> =>
  RabbitMQService.MoveMessages(connID, request);

/** Spreads quorum queue leaders back across the nodes. */
export const rebalanceQueues = (connID: number): Promise<void> =>
  RabbitMQService.RebalanceQueues(connID);
