import { useCallback } from "react";
import type { ClusterView } from "@/api/models";
import * as clusterApi from "@/api/cluster";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every server the connection can reach, and the cluster's own summary.
 *
 * One request rather than two: the canonical ClusterService answers both in a
 * round trip, and the summary is the servers' figures added up - reading them
 * separately would let a page show a total that disagreed with the rows under
 * it.
 *
 * How many servers that is depends on which tier answered, which is the thing
 * this page has to be honest about. With system-account credentials the
 * request fans out and every server in the cluster replies; with only a
 * monitoring address it is the one server that address belongs to. The rows
 * carry which, and the board says so rather than presenting one server as the
 * cluster.
 */
export function useNatsCluster(): BrokerData<ClusterView> {
  const load = useCallback((connID: number) => clusterApi.getClusterView(connID), []);
  return useBrokerData(load);
}

/**
 * One server's effective configuration.
 *
 * A second request rather than a field on the row, because it is a few hundred
 * settings per server and the listing would carry all of it for every one.
 */
export function useNatsServerConfig(server: string | null): BrokerData<clusterApi.ConfigDocument> {
  const load = useCallback(
    async (connID: number) => (server == null ? {} : clusterApi.getNodeConfig(connID, server)),
    [server],
  );
  return useBrokerData(load, { enabled: server != null, refreshMs: null });
}
