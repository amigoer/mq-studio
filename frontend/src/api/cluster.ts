import { ACTIVE_CONNECTION } from "./connectionScope";
import { ClusterService } from "@bindings/bridge";
import type { BrokerNode, ClusterInfo, ClusterSummary } from "./models";
import { present, required } from "./client";

export const getBrokers = (): Promise<BrokerNode[]> =>
  ClusterService.Brokers(ACTIVE_CONNECTION).then(present);
export const getClusterInfo = (): Promise<ClusterInfo> =>
  ClusterService.Info(ACTIVE_CONNECTION).then(required);
export const getClusterSummary = (): Promise<ClusterSummary> =>
  ClusterService.Summary(ACTIVE_CONNECTION).then(required);
export const getBrokerDetail = (brokerAddr: string): Promise<BrokerNode> =>
  ClusterService.BrokerDetail(ACTIVE_CONNECTION, brokerAddr).then(required);
