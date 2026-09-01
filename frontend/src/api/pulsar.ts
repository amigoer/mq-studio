import { PulsarService } from "@bindings/bridge";
import type {
  PulsarNamespaceInput,
  PulsarTenantInput,
  PulsarTenantView,
  PulsarTopicInput,
} from "@bindings/bridge/models";
import type { Destination, Namespace } from "@bindings/model/models";
import { present, required } from "./client";

export type {
  Destination,
  Namespace,
  PulsarNamespaceInput,
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
