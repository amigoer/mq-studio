import { useCallback } from "react";
import type { ClusterView, SlowLogEntry } from "@/api/models";
import * as clusterApi from "@/api/cluster";
import * as redisApi from "@/api/redis";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every server behind this connection, and the header they sit under.
 *
 * One call rather than two: a cluster can have every node online and still be
 * missing hash slots, which only the overview reports and which is the one
 * thing that makes the node list misleading on its own - so the two must not
 * be able to arrive out of step.
 */
export function useRedisServers(): BrokerData<ClusterView> {
  const load = useCallback((connID: number) => clusterApi.getClusterView(connID), []);
  return useBrokerData(load);
}

/**
 * One server's slow log.
 *
 * It does not poll with the rest of the page. The log only changes when
 * something was slow, and re-reading it every thirty seconds would move rows
 * under someone who is reading them - which on the one page in this app that
 * shows individual requests is exactly the wrong behaviour.
 */
export function useRedisSlowLog(address: string | null): BrokerData<SlowLogEntry[]> {
  const load = useCallback(
    async (connID: number) => (address == null ? [] : redisApi.slowLog(connID, address)),
    [address],
  );
  return useBrokerData(load, { enabled: address != null, refreshMs: null });
}
