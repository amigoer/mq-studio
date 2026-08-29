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
