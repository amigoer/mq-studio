import { useCallback } from "react";
import { getClusterView } from "@/api/cluster";
import type { ClusterOverview, Node } from "@/api/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface KafkaCluster {
  overview: ClusterOverview;
  nodes: Node[];
}

/**
 * The cluster snapshot every Kafka board reads its header from.
 *
 * One request: the brokers, the counts derived from one metadata walk, and the
 * partition health that walk is the only source of. Splitting them would mean
 * two walks that could disagree with each other.
 *
 * The nulls the bindings type into every pointer slice are dropped here rather
 * than in each board, which would otherwise carry the same guard four times
 * over for a case the driver never produces.
 */
export function useKafkaCluster(): BrokerData<KafkaCluster> {
  return useBrokerData(
    useCallback(
      (connID: number) =>
        getClusterView(connID).then((view) => ({
          overview: view.overview,
          nodes: (view.nodes ?? []).filter((node): node is Node => node != null),
        })),
      [],
    ),
  );
}
