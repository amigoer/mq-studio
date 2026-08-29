import { useCallback } from "react";
import type { ClusterView, Node } from "@/api/models";
import * as clusterApi from "@/api/cluster";
import { present } from "@/api/client";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface ClusterSnapshot {
  cluster: ClusterView;
  nodes: Node[];
}

/**
 * The cluster page's one read.
 *
 * Info already carries the nodes, so asking Brokers as well would run the same
 * topology query twice and double-sample the TPS history the collector keeps.
 */
export function useCluster(): BrokerData<ClusterSnapshot> {
  const load = useCallback(async (connID: number): Promise<ClusterSnapshot> => {
    const cluster = await clusterApi.getClusterView(connID);
    return { cluster, nodes: present(cluster?.nodes) };
  }, []);

  return useBrokerData(load);
}
