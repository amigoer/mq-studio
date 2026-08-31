import { useCallback } from "react";
import { getClusterView, getNodeConfig, type ConfigDocument } from "@/api/cluster";
import { getKafkaLogDirs } from "@/api/kafka";
import type { LogDirView } from "@bindings/bridge/models";
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

/**
 * The cluster's storage.
 *
 * A request to every broker, so it is the cluster page's own call and never
 * part of the overview: the numbers are worth a round trip only when somebody
 * is looking at them.
 */
export function useKafkaLogDirs(enabled: boolean): BrokerData<LogDirView> {
  return useBrokerData(
    useCallback((connID: number) => getKafkaLogDirs(connID), []),
    { enabled },
  );
}

/**
 * One broker's effective settings - what it is running with, which is not
 * always what its properties file says.
 */
export function useKafkaBrokerConfig(address: string | null): BrokerData<ConfigDocument> {
  return useBrokerData(
    useCallback(
      (connID: number) => {
        if (address == null) throw new Error("no broker selected");
        return getNodeConfig(connID, address);
      },
      [address],
    ),
    { enabled: address != null },
  );
}
