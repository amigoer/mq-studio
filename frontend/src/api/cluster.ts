import { ClusterService } from "@bindings/bridge";
import type { Node, ClusterView, ClusterSummary } from "./models";
import { present, required } from "./client";

export const getBrokers = (connID: number): Promise<Node[]> =>
  ClusterService.Brokers(connID).then(present);
export const getClusterView = (connID: number): Promise<ClusterView> =>
  ClusterService.Info(connID).then(required);
export const getClusterSummary = (connID: number): Promise<ClusterSummary> =>
  ClusterService.Summary(connID).then(required);
export const getBrokerDetail = (connID: number, brokerAddr: string): Promise<Node> =>
  ClusterService.BrokerDetail(connID, brokerAddr).then(required);

/**
 * A settings document, as a node reports it. Values read optional because the
 * bindings type every index access that way, not because a key can be absent.
 */
export type ConfigDocument = Record<string, string | undefined>;

/** One broker's effective settings, as the broker reports them. */
export const getNodeConfig = (connID: number, brokerAddr: string): Promise<ConfigDocument> =>
  ClusterService.NodeConfig(connID, brokerAddr);

/** The name servers' effective settings: one answer for the whole tier. */
export const getDirectoryConfig = (connID: number): Promise<ConfigDocument> =>
  ClusterService.DirectoryConfig(connID);
