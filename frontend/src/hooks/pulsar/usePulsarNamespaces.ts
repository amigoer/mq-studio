import { useCallback } from "react";
import { getPulsarNamespaces, getPulsarTenants, type PulsarTenantView } from "@/api/pulsar";
import type { Namespace } from "@/api/pulsar";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every namespace under the connection's tenant.
 *
 * Scoped to one tenant because the driver is: listing every tenant's
 * namespaces needs a superuser, and the connection form asks for the tenant
 * precisely because most credentials only reach one.
 */
export function usePulsarNamespaces(): BrokerData<Namespace[]> {
  return useBrokerData(useCallback((connID: number) => getPulsarNamespaces(connID), []));
}

/**
 * Every tenant on the cluster.
 *
 * A separate request from the namespaces, and deliberately so: listing tenants
 * needs a superuser and a scoped credential gets a 403, so folding the two
 * together would make a namespace page fail for a connection that can read its
 * own namespaces perfectly well.
 */
export function usePulsarTenants(enabled: boolean): BrokerData<PulsarTenantView[]> {
  return useBrokerData(
    useCallback((connID: number) => getPulsarTenants(connID), []),
    { enabled, refreshMs: null },
  );
}
