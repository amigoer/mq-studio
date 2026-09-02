/**
 * Redis's view of a canonical node.
 *
 * The keys are a contract with internal/driver/redisstream/cluster.go.
 *
 * The two figures this family does not report are the two most families do:
 * a message rate and a disk percentage. Redis counts commands, not messages,
 * and reports memory, not disk - so the driver sends UnknownMetric for both
 * and the readers here offer what it does have under its own names.
 */
import type { ClusterOverview, Node } from "@bindings/model/models";

const AttrRole = "role";
const AttrMode = "mode";
const AttrUptimeSeconds = "uptimeSeconds";
const AttrConnectedClients = "connectedClients";
const AttrUsedMemory = "usedMemory";
const AttrMaxMemory = "maxMemory";
const AttrMemoryFragmentation = "memoryFragmentation";
const AttrOpsPerSec = "opsPerSec";
const AttrKeyspaceHits = "keyspaceHits";
const AttrKeyspaceMisses = "keyspaceMisses";
const AttrAOFEnabled = "aofEnabled";
const AttrRDBLastSave = "rdbLastSaveTime";
const AttrRDBLastStatus = "rdbLastBgsaveStatus";
const AttrRDBChangesSince = "rdbChangesSinceLastSave";
const AttrAOFLastStatus = "aofLastRewriteStatus";
const AttrConnectedReplica = "connectedReplicas";
const AttrClusterEnabled = "clusterEnabled";
const AttrClusterSlots = "clusterSlots";
const AttrClusterState = "clusterState";
const AttrNodeID = "nodeId";

function attr(node: Node, key: string): string | null {
  const value = node.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(node: Node, key: string): number | null {
  const raw = attr(node, key);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export const nodeAddress = (node: Node): string => node.address;
export const nodeVersion = (node: Node): string | null =>
  node.version === "" ? null : node.version;

/** master or replica. In a cluster it comes from CLUSTER NODES, not INFO. */
export const role = (node: Node): string | null => attr(node, AttrRole);

/** standalone, sentinel or cluster, as the server describes itself. */
export const mode = (node: Node): string | null => attr(node, AttrMode);

export const clusterNodeId = (node: Node): string | null => attr(node, AttrNodeID);
export const ownedSlots = (node: Node): string | null => attr(node, AttrClusterSlots);
export const uptimeSeconds = (node: Node): number | null => number(node, AttrUptimeSeconds);
export const connectedClients = (node: Node): number | null =>
  number(node, AttrConnectedClients);

/**
 * Commands per second, which is what Redis actually counts.
 *
 * It is deliberately not the node's rateIn or rateOut: those mean messages,
 * and a command is not a message - one XADD is one of each, but so is one GET
 * that moved nothing at all.
 */
export const opsPerSec = (node: Node): number | null => number(node, AttrOpsPerSec);

export const usedMemoryBytes = (node: Node): number | null => number(node, AttrUsedMemory);

/**
 * The memory cap, or null when there is none.
 *
 * Redis reports 0 for "no limit", which is the opposite of what a 0 would mean
 * on a meter. Without this the node board would draw a server with no cap as
 * one that is permanently full.
 */
export function maxMemoryBytes(node: Node): number | null {
  const value = number(node, AttrMaxMemory);
  return value == null || value === 0 ? null : value;
}

/** How full memory is, or null when the server has no cap to be full of. */
export function memoryUsagePercent(node: Node): number | null {
  const used = usedMemoryBytes(node);
  const max = maxMemoryBytes(node);
  if (used == null || max == null) return null;
  return Math.min(100, Math.round((used / max) * 100));
}

export const memoryFragmentation = (node: Node): number | null =>
  number(node, AttrMemoryFragmentation);

/**
 * The keyspace hit rate, or null when nothing has been looked up yet.
 *
 * Zero hits and zero misses is a server nobody has read from, not one that
 * misses everything - and 0% on a fresh server would send someone looking for
 * a cache problem that does not exist.
 */
export function hitRatePercent(node: Node): number | null {
  const hits = number(node, AttrKeyspaceHits);
  const misses = number(node, AttrKeyspaceMisses);
  if (hits == null || misses == null) return null;
  const total = hits + misses;
  return total === 0 ? null : Math.round((hits / total) * 1000) / 10;
}

export const appendOnlyEnabled = (node: Node): boolean =>
  attr(node, AttrAOFEnabled) === "1";
export const clusterEnabled = (node: Node): boolean =>
  attr(node, AttrClusterEnabled) === "1";
export const connectedReplicas = (node: Node): number | null =>
  number(node, AttrConnectedReplica);

/** Unix seconds of the last successful snapshot, or null if there has been none. */
export function lastSaveUnix(node: Node): number | null {
  const value = number(node, AttrRDBLastSave);
  return value == null || value === 0 ? null : value;
}

/** How many writes have happened since the last snapshot: what a restart loses. */
export const changesSinceLastSave = (node: Node): number | null =>
  number(node, AttrRDBChangesSince);

/**
 * Whether the last snapshot and append-log rewrite succeeded.
 *
 * Null on a server that has never run one, which is a different fact from
 * having run one that failed - and the difference is whether anyone needs to
 * do something about it.
 */
export function persistenceHealthy(node: Node): boolean | null {
  const snapshot = attr(node, AttrRDBLastStatus);
  const rewrite = attr(node, AttrAOFLastStatus);
  if (snapshot == null && rewrite == null) return null;
  return snapshot !== "err" && rewrite !== "err";
}

/** Whether the cluster can serve every key, or null on a non-cluster. */
export function clusterState(overview: ClusterOverview): string | null {
  const value = overview.attributes?.[AttrClusterState];
  return value == null || value === "" ? null : value;
}

/**
 * How many hash slots are assigned, out of the 16384 a cluster has.
 *
 * A cluster missing slots cannot serve the keys in them, and nothing in the
 * node list says so: every node can be online while a range belongs to none of
 * them.
 */
export function assignedSlots(overview: ClusterOverview): number | null {
  const raw = overview.attributes?.[AttrClusterSlots];
  if (raw == null || raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

/** Every hash slot a Redis cluster has. */
export const TOTAL_SLOTS = 16384;

/** True when the cluster is short of slots, which is a keyspace it cannot serve. */
export function slotsIncomplete(overview: ClusterOverview): boolean {
  const assigned = assignedSlots(overview);
  return assigned != null && assigned < TOTAL_SLOTS;
}

/** An uptime in the units a reader thinks in. */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
