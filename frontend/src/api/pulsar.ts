import { MessageService, PulsarService } from "@bindings/bridge";
import type {
  PulsarNamespaceInput,
  PulsarTenantInput,
  PulsarPublishInput,
  PulsarPublishResult,
  PulsarTenantView,
  PulsarTopicInput,
} from "@bindings/bridge/models";
import type {
  DeadLetterQueue,
  Destination,
  MessageItem,
  Namespace,
  ProducerClient,
  SubscriptionClient,
} from "@bindings/model/models";
import { present, required } from "./client";

export type {
  DeadLetterQueue,
  Destination,
  MessageItem,
  Namespace,
  SubscriptionClient,
  PulsarNamespaceInput,
  ProducerClient,
  PulsarPublishInput,
  PulsarPublishResult,
  PulsarTenantInput,
  PulsarTenantView,
  PulsarTopicInput,
};

/**
 * What only Pulsar has.
 *
 * Topics, subscriptions, namespaces and brokers are not here: they are
 * destinations, subscriptions, namespaces and nodes, and the canonical APIs
 * already answer them. A second read path would be two sources for one number.
 */

/** Every tenant on the cluster. Listing them needs a superuser. */
export const getPulsarTenants = (connID: number): Promise<PulsarTenantView[]> =>
  PulsarService.Tenants(connID).then(present);

/** Creates a tenant, or updates the one already there. */
export const savePulsarTenant = (connID: number, input: PulsarTenantInput): Promise<void> =>
  PulsarService.SaveTenant(connID, input);

/** Deletes a tenant. Pulsar refuses while it still holds namespaces. */
export const removePulsarTenant = (connID: number, name: string): Promise<void> =>
  PulsarService.RemoveTenant(connID, name);

/** What the tenant form offers for its allowed-cluster list. */
export const getPulsarClusters = (connID: number): Promise<string[]> =>
  PulsarService.Clusters(connID).then(present);

/** Every namespace under the profile's tenant, with the limits actually set. */
export const getPulsarNamespaces = (connID: number): Promise<Namespace[]> =>
  PulsarService.Namespaces(connID).then(present);

/** Adds a namespace. A bare name is created under this connection's tenant. */
export const createPulsarNamespace = (connID: number, name: string): Promise<void> =>
  PulsarService.CreateNamespace(connID, { name } as PulsarNamespaceInput);

/** Deletes one. Pulsar refuses while it still holds topics. */
export const removePulsarNamespace = (connID: number, name: string): Promise<void> =>
  PulsarService.DeleteNamespace(connID, name);

/** Caps a namespace as a whole. */
export const setPulsarNamespaceLimit = (
  connID: number,
  name: string,
  limit: string,
  value: number,
): Promise<void> => PulsarService.SetNamespaceLimit(connID, name, limit, value);

/**
 * Hands a limit back to the broker's own default.
 *
 * Separate from setting zero, and the distinction is the point: zero producers
 * is a namespace nothing can publish to, and no limit is the broker deciding.
 */
export const removePulsarNamespaceLimit = (
  connID: number,
  name: string,
  limit: string,
): Promise<void> => PulsarService.RemoveNamespaceLimit(connID, name, limit);

/**
 * Every topic in one namespace.
 *
 * Namespace-scoped, which the canonical topic API is not: a Pulsar topic is
 * addressed as tenant/namespace/name, and TopicService.Detail builds a ref
 * with no namespace in it at all.
 */
export const getPulsarTopics = (
  connID: number,
  namespace: string,
  includeInternal = false,
): Promise<Destination[]> =>
  PulsarService.Topics(connID, namespace, includeInternal).then(present);

export const getPulsarTopicDetail = (
  connID: number,
  namespace: string,
  name: string,
): Promise<Destination> =>
  PulsarService.TopicDetail(connID, namespace, name).then(required);

/** The per-partition breakdown the detail panel draws. */
export const getPulsarTopicStats = (
  connID: number,
  namespace: string,
  name: string,
): Promise<Record<string, unknown>> => PulsarService.TopicStats(connID, namespace, name);

/** Declares a topic. Zero partitions is a non-partitioned topic, not a default. */
export const createPulsarTopic = (
  connID: number,
  input: PulsarTopicInput,
): Promise<void> => PulsarService.CreateTopic(connID, input);

/** Adds partitions. Pulsar can never remove them. */
export const raisePulsarPartitions = (
  connID: number,
  input: PulsarTopicInput,
): Promise<void> => PulsarService.RaisePartitions(connID, input);

/** Deletes a topic. Pulsar refuses while a client is still attached. */
export const removePulsarTopic = (
  connID: number,
  namespace: string,
  name: string,
): Promise<void> => PulsarService.DeleteTopic(connID, namespace, name);

/**
 * One subscription's figures.
 *
 * Topic-scoped, which the canonical consumer API is not: a Pulsar subscription
 * has no identity without the topic it belongs to.
 */
export const getPulsarSubscriptionStats = (
  connID: number,
  topic: string,
  subscription: string,
): Promise<Record<string, unknown>> =>
  PulsarService.SubscriptionStats(connID, topic, subscription);

/** Who is attached, as the broker reports them. */
export const getPulsarSubscriptionClients = (
  connID: number,
  topic: string,
  subscription: string,
): Promise<SubscriptionClient[]> =>
  PulsarService.SubscriptionClients(connID, topic, subscription).then(present);

/** Adds a subscription. "earliest" or "latest". */
export const createPulsarSubscription = (
  connID: number,
  topic: string,
  subscription: string,
  startAt: string,
): Promise<void> =>
  PulsarService.CreateSubscription(connID, topic, subscription, startAt);

/** Deletes one. Pulsar refuses while a consumer is attached. */
export const removePulsarSubscription = (
  connID: number,
  topic: string,
  subscription: string,
): Promise<void> => PulsarService.DeleteSubscription(connID, topic, subscription);

/**
 * Browses a topic with the filters this family has.
 *
 * Separate from queryMessagesByCondition because the shared form's fields do
 * not fit: Pulsar has no tag, so what every other family narrows by has no
 * value here, and what replaces it is a filter on the message's own
 * properties. The topic is a full URL, which is how a Pulsar topic is
 * addressed at all.
 */
export const browsePulsarMessages = (
  connID: number,
  topic: string,
  condition: {
    messageId?: string;
    messageKey?: string;
    property?: string;
    startTimeMs?: number;
    endTimeMs?: number;
  },
  maxResults = 0,
): Promise<MessageItem[]> => {
  const id = condition.messageId?.trim() ?? "";
  if (id !== "") {
    return MessageService.ByID(connID, topic, id).then((item) => (item ? [item] : []));
  }
  const filters: Record<string, string> = {};
  const property = condition.property?.trim() ?? "";
  if (property !== "") filters["property"] = property;

  return MessageService.Query(connID, {
    topic,
    key: condition.messageKey?.trim() ?? "",
    // Pulsar has no tag. Sending an empty one is not a gap in the form - there
    // is nothing on this family for it to mean.
    tag: "",
    maxResults,
    startTime: condition.startTimeMs ?? 0,
    endTime: condition.endTimeMs ?? 0,
    filters,
  }).then(present);
};

/**
 * The topics dead letters land in, and the subscription each came from.
 *
 * A Pulsar dead-letter topic is a naming convention in the client libraries,
 * not a broker object, so this is a walk of the namespace rather than a
 * question about a consumer group.
 */
export const getPulsarDeadLetterQueues = (
  connID: number,
  namespace: string,
): Promise<DeadLetterQueue[]> =>
  PulsarService.DeadLetterQueues(connID, namespace).then(present);

/** Sends one or more messages in Pulsar's own vocabulary. */
export const publishPulsarMessage = (
  connID: number,
  input: PulsarPublishInput,
): Promise<PulsarPublishResult> => PulsarService.Publish(connID, input).then(required);

/** Who is currently publishing to a topic, as the broker reports them. */
export const getPulsarProducers = (
  connID: number,
  topic: string,
): Promise<ProducerClient[]> => PulsarService.Producers(connID, topic).then(present);
