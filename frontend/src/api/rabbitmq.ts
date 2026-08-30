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
