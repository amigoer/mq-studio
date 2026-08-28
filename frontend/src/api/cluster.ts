import { ACTIVE_CONNECTION } from "./connectionScope";
import { ClusterService } from "@bindings/bridge";
import type { Node, ClusterView, ClusterSummary } from "./models";
import { present, required } from "./client";

export const getBrokers = (): Promise<Node[]> =>
  ClusterService.Brokers(ACTIVE_CONNECTION).then(present);
export const getClusterView = (): Promise<ClusterView> =>
  ClusterService.Info(ACTIVE_CONNECTION).then(required);
export const getClusterSummary = (): Promise<ClusterSummary> =>
  ClusterService.Summary(ACTIVE_CONNECTION).then(required);
export const getBrokerDetail = (brokerAddr: string): Promise<Node> =>
  ClusterService.BrokerDetail(ACTIVE_CONNECTION, brokerAddr).then(required);
