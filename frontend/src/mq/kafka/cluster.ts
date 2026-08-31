/**
 * Kafka's view of the canonical cluster models.
 *
 * The keys are a contract with internal/driver/kafka/cluster.go.
 *
 * What is absent matters as much as what is here. Kafka's admin protocol
 * reports no rate of any kind - produce and consume rates live in JMX, which
 * this app does not speak - so the canonical rate fields carry the unknown
 * sentinel and no Kafka board draws a per-second figure. Metadata carries no
 * disk figure either; that arrives with the log directories.
 *
 * What Kafka has instead is partition health, and it is the whole reason its
 * overview exists: a partition can be under-replicated, offline, or without a
 * leader entirely, and those are three different degrees of trouble.
 */
import type { ClusterOverview, Node } from "@bindings/model/models";

const AttrNodeID = "nodeId";
const AttrRack = "rack";
const AttrController = "controller";

const AttrClusterID = "clusterId";
const AttrControllerNode = "controllerNode";
const AttrTopicCount = "topics";
const AttrInternalTopicCount = "internalTopics";
const AttrPartitionCount = "partitions";
const AttrUnderReplicated = "underReplicatedPartitions";
const AttrOfflinePartitions = "offlinePartitions";
const AttrLeaderlessPartitions = "leaderlessPartitions";
const AttrGroupCount = "consumerGroups";

function attr(source: { attributes?: Record<string, string | undefined> }, key: string): string {
  return source.attributes?.[key] ?? "";
}

/**
 * A counter the driver did not report reads as unknown, not as zero.
 *
 * The difference is the point: "no partition is under-replicated" and "nobody
 * asked" look identical once both are rendered as 0, and only one of them
 * means the cluster is healthy.
 */
function count(source: { attributes?: Record<string, string | undefined> }, key: string): number | null {
  const raw = attr(source, key);
  if (raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export const nodeID = (node: Node): string => attr(node, AttrNodeID);
export const rack = (node: Node): string => attr(node, AttrRack);
export const isController = (node: Node): boolean => attr(node, AttrController) === "true";

export const clusterID = (overview: ClusterOverview): string => attr(overview, AttrClusterID);
export const controllerNode = (overview: ClusterOverview): string =>
  attr(overview, AttrControllerNode);
export const topicCount = (overview: ClusterOverview): number | null =>
  count(overview, AttrTopicCount);
export const internalTopicCount = (overview: ClusterOverview): number | null =>
  count(overview, AttrInternalTopicCount);
export const partitionCount = (overview: ClusterOverview): number | null =>
  count(overview, AttrPartitionCount);
export const underReplicatedPartitions = (overview: ClusterOverview): number | null =>
  count(overview, AttrUnderReplicated);
export const offlinePartitions = (overview: ClusterOverview): number | null =>
  count(overview, AttrOfflinePartitions);
export const leaderlessPartitions = (overview: ClusterOverview): number | null =>
  count(overview, AttrLeaderlessPartitions);
export const consumerGroupCount = (overview: ClusterOverview): number | null =>
  count(overview, AttrGroupCount);

/**
 * Whether anything is wrong with the partitions.
 *
 * One question rather than three because that is how the page is read: an
 * operator glances at the overview to find out whether to keep looking, and
 * any one of the three failures means yes.
 */
export function partitionsAreHealthy(overview: ClusterOverview): boolean {
  return [underReplicatedPartitions, offlinePartitions, leaderlessPartitions].every(
    (read) => read(overview) === 0,
  );
}

/*
 * A transaction's age, as a label.
 *
 * Unknown when the coordinator did not report a start time, and unknown again
 * when the answer would be negative: the broker's clock and this machine's are
 * not the same clock, and a transaction that appears to start in the future is
 * skew rather than news.
 */
export function transactionAge(startedAt: number, now: number): string {
  if (startedAt < 0 || now < startedAt) return "—";
  const seconds = Math.floor((now - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Whether a transaction has outlived the deadline the cluster set for it.
 *
 * This is the one that means something is wrong rather than merely slow: the
 * coordinator undertook to abort the transaction after its timeout, so one
 * still open well past it is not a long-running job, it is a transaction
 * nothing is finishing.
 */
export function transactionOverdue(
  startedAt: number,
  timeoutMs: number,
  now: number,
): boolean {
  if (startedAt < 0 || timeoutMs <= 0) return false;
  return now - startedAt > timeoutMs;
}
