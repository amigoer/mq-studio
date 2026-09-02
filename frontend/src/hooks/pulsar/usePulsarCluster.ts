import { useCallback } from "react";
import { getClusterView, getDirectoryConfig, getNodeConfig, type ConfigDocument } from "@/api/cluster";
import type { ClusterOverview, Node } from "@/api/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface PulsarCluster {
  overview: ClusterOverview;
  nodes: Node[];
}

/**
 * The cluster snapshot the Pulsar overview and brokers boards read.
 *
 * One request: the active brokers and the header counts come from the same
 * pair of admin calls, so splitting them would mean two listings that could
 * disagree about how many brokers there are.
 *
 * The nulls the bindings type into every pointer slice are dropped here rather
 * than in each board, which would otherwise carry the same guard twice for a
 * case the driver never produces.
 */
export function usePulsarCluster(): BrokerData<PulsarCluster> {
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
 * What the broker is actually running with.
 *
 * Pulsar has no per-broker admin endpoint - every call goes to the web service
 * address the profile names - so this is a broker's configuration rather than
 * that broker's. The address is passed through anyway so the panel and the
 * driver agree about which row was opened.
 */
export function usePulsarBrokerConfig(address: string | null): BrokerData<ConfigDocument> {
  return useBrokerData(
    useCallback(
      (connID: number) => {
        if (address == null) throw new Error("no broker selected");
        return getNodeConfig(connID, address);
      },
      [address],
    ),
    { enabled: address != null, refreshMs: null },
  );
}

/**
 * The metadata store the cluster keeps its state in - Pulsar's discovery tier,
 * and the answer to "what is this cluster pointed at".
 */
export function usePulsarMetadataStore(enabled: boolean): BrokerData<ConfigDocument> {
  return useBrokerData(
    useCallback((connID: number) => getDirectoryConfig(connID), []),
    { enabled, refreshMs: null },
  );
}
