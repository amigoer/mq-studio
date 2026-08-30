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
  PublishResult,
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
  PublishResult,
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

export interface ExchangeDeclaration {
  vhost: string;
  name: string;
  type: string;
  transient: boolean;
  autoDelete: boolean;
  arguments: string;
}

/** Declares an exchange. Re-declaring with a different type is an error. */
export const declareExchange = (
  connID: number,
  exchange: ExchangeDeclaration,
): Promise<void> => RabbitMQService.DeclareExchange(connID, exchange);

/** Deletes an exchange, and its bindings with it. */
export const deleteExchange = (connID: number, vhost: string, name: string): Promise<void> =>
  RabbitMQService.DeleteExchange(connID, vhost, name);

export interface BindingInput {
  vhost: string;
  source: string;
  destination: string;
  destinationKind: string;
  routingKey: string;
  arguments: Record<string, string>;
  /** Required to delete; it comes from the listing and is never made up. */
  propertiesKey: string;
}

export const declareBinding = (connID: number, binding: BindingInput): Promise<void> =>
  RabbitMQService.DeclareBinding(connID, binding);

export const deleteBinding = (connID: number, binding: BindingInput): Promise<void> =>
  RabbitMQService.DeleteBinding(connID, binding);

export interface PublishInput {
  vhost: string;
  /** Empty is the default exchange, which routes by queue name. */
  exchange: string;
  routingKey: string;
  body: string;
  persistent: boolean;
  mandatory: boolean;
  headers: Record<string, string>;
  contentType: string;
  correlationId: string;
  replyTo: string;
  messageId: string;
  type: string;
  appId: string;
  expiration: string;
  priority: number;
  count: number;
}

/**
 * Sends a message and reports what the broker did with it.
 *
 * Sent and unroutable are two different facts: a confirm means the broker took
 * the message, routing means something was bound to receive it. An unroutable
 * publish is confirmed and then dropped.
 */
export const publish = (connID: number, input: PublishInput): Promise<PublishResult | null> =>
  RabbitMQService.Publish(connID, input);

/**
 * Discards a bounded batch from the head of a queue and reports how many are
 * gone.
 *
 * Not a purge: a purge empties the whole queue in one broker call and cannot
 * be bounded. This acknowledges a fixed number, which is what "discard these
 * ten and leave the rest" means. There is no undo either way.
 */
export const dropMessages = (
  connID: number,
  vhost: string,
  name: string,
  limit: number,
): Promise<number> => RabbitMQService.DropMessages(connID, vhost, name, limit);
