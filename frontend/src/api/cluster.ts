import { ClusterService } from "@bindings/bridge";
import type { Node, ClusterView, MaintenanceTaskView } from "./models";
import { present, required } from "./client";

export type { MaintenanceTaskView };

export const getBrokers = (connID: number): Promise<Node[]> =>
  ClusterService.Brokers(connID).then(present);
export const getClusterView = (connID: number): Promise<ClusterView> =>
  ClusterService.Info(connID).then(required);
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

/**
 * The housekeeping jobs a node can be asked to run.
 *
 * The set is closed and comes from Go, so the renderer cannot trigger a task
 * that has not been reviewed and marked for how much it destroys.
 */
export const getMaintenanceTasks = (): Promise<MaintenanceTaskView[]> =>
  ClusterService.MaintenanceTasks().then(present);

export const runMaintenance = (
  connID: number,
  brokerAddr: string,
  task: string,
): Promise<void> => ClusterService.RunMaintenance(connID, brokerAddr, task);

/**
 * Takes a broker out of the write path, or puts it back, and returns how many
 * destinations the change touched.
 *
 * Named rather than addressed: write permission lives in the route table,
 * which a master and its slaves share under one broker name.
 */
export const setBrokerWritable = (
  connID: number,
  brokerName: string,
  writable: boolean,
): Promise<number> => ClusterService.SetBrokerWritable(connID, brokerName, writable);
