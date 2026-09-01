import { PulsarService } from "@bindings/bridge";
import type {
  PulsarNamespaceInput,
  PulsarTenantInput,
  PulsarTenantView,
} from "@bindings/bridge/models";
import type { Namespace } from "@bindings/model/models";
import { present } from "./client";

export type { Namespace, PulsarNamespaceInput, PulsarTenantInput, PulsarTenantView };

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
