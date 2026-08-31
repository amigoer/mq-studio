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
  Identity,
  Namespace,
  Policy,
  PublishResult,
  RuntimeParameter,
  TopicPermission,
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
  Identity,
  Namespace,
  NamespacePermission,
  Policy,
  PublishResult,
  RuntimeParameter,
  TopicPermission,
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

/**
 * Disconnects one client connection.
 *
 * The reason reaches the client being disconnected and the broker's log, so an
 * application that suddenly loses its connection can find out from its own
 * logs who did it and why.
 */
export const closeClientConnection = (
  connID: number,
  name: string,
  reason: string,
): Promise<void> => RabbitMQService.CloseClientConnection(connID, name, reason);

/** Disconnects every connection one user holds. */
export const closeUserConnections = (
  connID: number,
  username: string,
  reason: string,
): Promise<void> => RabbitMQService.CloseUserConnections(connID, username, reason);

/** Every virtual host, with the limits set on each. */
export const getNamespaces = (connID: number): Promise<Namespace[]> =>
  RabbitMQService.Namespaces(connID).then(present);

export interface NamespaceInput {
  name: string;
  description: string;
  tags: string[];
  defaultQueueType: string;
  tracing: boolean;
}

/** Creates a virtual host, or updates one that already exists. */
export const saveNamespace = (connID: number, input: NamespaceInput): Promise<void> =>
  RabbitMQService.SaveNamespace(connID, input);

/** Deletes a virtual host and everything inside it. */
export const deleteNamespace = (connID: number, name: string): Promise<void> =>
  RabbitMQService.DeleteNamespace(connID, name);

/**
 * Caps a virtual host. A negative value lifts the cap entirely, which is not
 * the same as a cap of zero - zero forbids everything.
 */
export const setNamespaceLimit = (
  connID: number,
  name: string,
  limit: string,
  value: number,
): Promise<void> => RabbitMQService.SetNamespaceLimit(connID, name, limit, value);

/** The limits a virtual host can carry, as the broker names them. */
export const LIMIT_MAX_CONNECTIONS = "max-connections";
export const LIMIT_MAX_QUEUES = "max-queues";

/** Every user, with its per-virtual-host permissions attached. */
export const getIdentities = (connID: number): Promise<Identity[]> =>
  RabbitMQService.Identities(connID).then(present);

export interface IdentityInput {
  name: string;
  tags: string[];
  /** Empty keeps whatever is stored, which is what lets tags be edited. */
  password: string;
  /**
   * Asks for a user that cannot authenticate with a password at all -
   * legitimate for certificate or OAuth authentication.
   *
   * A separate flag from an empty password because the two are opposite
   * instructions: the broker's update endpoint replaces the whole user, so
   * leaving the field out removes the password rather than keeping it, and
   * only the driver can tell those apart.
   */
  withoutPassword: boolean;
}

export const saveIdentity = (connID: number, input: IdentityInput): Promise<void> =>
  RabbitMQService.SaveIdentity(connID, input);

/** Deletes a user, its permissions and any connection it holds. */
export const deleteIdentity = (connID: number, name: string): Promise<void> =>
  RabbitMQService.DeleteIdentity(connID, name);

export interface PermissionInput {
  vhost: string;
  identity: string;
  /** Regular expressions: empty permits nothing, ".*" permits everything. */
  configure: string;
  write: string;
  read: string;
}

export const setPermission = (connID: number, input: PermissionInput): Promise<void> =>
  RabbitMQService.SetPermission(connID, input);

/**
 * Removes the permission record entirely.
 *
 * Not the same as granting nothing: with no record the broker refuses the
 * connection to that virtual host outright, where empty patterns let it
 * connect and then do nothing - which is far harder to diagnose.
 */
export const revokePermission = (
  connID: number,
  vhost: string,
  identity: string,
): Promise<void> => RabbitMQService.RevokePermission(connID, vhost, identity);

/** The per-exchange narrowing applied on top of the namespace permissions. */
export const getTopicPermissions = (connID: number): Promise<TopicPermission[]> =>
  RabbitMQService.TopicPermissions(connID).then(present);

/** Both user and operator policies, marked apart by the `operator` flag. */
export const getPolicies = (connID: number): Promise<Policy[]> =>
  RabbitMQService.Policies(connID).then(present);

/**
 * Which policies the broker says actually apply to one destination.
 *
 * Worth asking rather than working out: only the highest-priority match
 * applies and policies do not merge, which is the rule most people get wrong.
 */
export const getMatchingPolicies = (
  connID: number,
  vhost: string,
  name: string,
  kind: "queue" | "exchange",
): Promise<Policy[]> =>
  RabbitMQService.MatchingPolicies(connID, vhost, name, kind).then(present);

export interface PolicyInput {
  vhost: string;
  name: string;
  pattern: string;
  applyTo: string;
  priority: number;
  /** The settings applied, as JSON so an integer stays an integer. */
  definition: string;
  operator: boolean;
}

export const savePolicy = (connID: number, input: PolicyInput): Promise<void> =>
  RabbitMQService.SavePolicy(connID, input);

/** Deletes a policy. Every destination it applied to reverts at once. */
export const deletePolicy = (
  connID: number,
  vhost: string,
  name: string,
  operator: boolean,
): Promise<void> => RabbitMQService.DeletePolicy(connID, vhost, name, operator);

/** The component configuration the broker stores - shovels and federation live here. */
export const getRuntimeParameters = (connID: number): Promise<RuntimeParameter[]> =>
  RabbitMQService.RuntimeParameters(connID).then(present);

export const deleteRuntimeParameter = (
  connID: number,
  component: string,
  vhost: string,
  name: string,
): Promise<void> => RabbitMQService.DeleteRuntimeParameter(connID, component, vhost, name);
