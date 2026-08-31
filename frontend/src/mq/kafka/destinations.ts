/**
 * Kafka's view of a canonical destination.
 *
 * The keys are a contract with internal/driver/kafka/topic.go.
 *
 * What is absent matters as much as what is here. There is no rate: Kafka's
 * admin protocol reports none, and the canonical rate fields carry the unknown
 * sentinel. There is no subscriber count either - Kafka does not index topics
 * by who reads them, so which groups consume a topic is only knowable by
 * walking every group's committed offsets, which is the consumer page's
 * request and not the topic list's.
 */
import type { Destination } from "@bindings/model/models";

const AttrInternal = "internal";
const AttrReplicationFactor = "replicationFactor";
const AttrMinISR = "minInsyncReplicas";
const AttrCleanupPolicy = "cleanupPolicy";
const AttrRetentionMs = "retentionMs";
const AttrRetentionBytes = "retentionBytes";
const AttrUnderReplicated = "underReplicatedPartitions";
const AttrOffline = "offlinePartitions";
const AttrLeaderless = "leaderlessPartitions";

/** The unknown sentinel every canonical numeric field uses. */
export const UNKNOWN = -1;

function attr(topic: Destination, key: string): string {
  return topic.attributes?.[key] ?? "";
}

/** A counter the driver did not report reads as unknown, never as zero. */
function count(topic: Destination, key: string): number | null {
  const raw = attr(topic, key);
  if (raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export const isInternal = (topic: Destination): boolean => attr(topic, AttrInternal) === "true";
export const replicationFactor = (topic: Destination): number | null =>
  count(topic, AttrReplicationFactor);
export const minInsyncReplicas = (topic: Destination): number | null =>
  count(topic, AttrMinISR);
export const cleanupPolicy = (topic: Destination): string => attr(topic, AttrCleanupPolicy);
export const retentionMs = (topic: Destination): number | null => count(topic, AttrRetentionMs);
export const retentionBytes = (topic: Destination): number | null =>
  count(topic, AttrRetentionBytes);
export const underReplicatedPartitions = (topic: Destination): number =>
  count(topic, AttrUnderReplicated) ?? 0;
export const offlinePartitions = (topic: Destination): number => count(topic, AttrOffline) ?? 0;
export const leaderlessPartitions = (topic: Destination): number =>
  count(topic, AttrLeaderless) ?? 0;

/**
 * Records readable in the topic right now.
 *
 * Not records ever written: retention and compaction move the start offset
 * forward, so this falls as well as rises. Null when the cluster would not
 * answer for the offsets, which must not read as an empty topic.
 */
export const readableRecords = (topic: Destination): number | null =>
  topic.depth === UNKNOWN ? null : topic.depth;

/** Whether anything is wrong with this topic's partitions. */
export const topicIsHealthy = (topic: Destination): boolean =>
  underReplicatedPartitions(topic) === 0 &&
  offlinePartitions(topic) === 0 &&
  leaderlessPartitions(topic) === 0;

/** One partition row, as DestinationStats sends it. */
export interface KafkaPartition {
  partition: number;
  leader: number;
  leaderEpoch: number;
  replicas: number[];
  isr: number[];
  offlineReplicas: number[];
  startOffset: number;
  endOffset: number;
  records: number;
  underReplicated: boolean;
}

/**
 * Reads the partition rows out of what DestinationStats returned.
 *
 * The payload is unstructured across the bridge - it is passed straight
 * through - so this is where it gets a shape, and where a driver that changed
 * the row keys would be caught by a test rather than by an empty table.
 */
export function partitionsOf(stats: Record<string, unknown> | null): KafkaPartition[] {
  if (stats == null) return [];
  const rows = stats.partitions;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    const numbers = (key: string): number[] => {
      const value = source[key];
      return Array.isArray(value) ? value.map(Number) : [];
    };
    return {
      partition: Number(source.partition ?? 0),
      leader: Number(source.leader ?? UNKNOWN),
      leaderEpoch: Number(source.leaderEpoch ?? UNKNOWN),
      replicas: numbers("replicas"),
      isr: numbers("isr"),
      offlineReplicas: numbers("offlineReplicas"),
      startOffset: Number(source.startOffset ?? UNKNOWN),
      endOffset: Number(source.endOffset ?? UNKNOWN),
      records: Number(source.records ?? UNKNOWN),
      underReplicated: source.underReplicated === true,
    };
  });
}

/** A partition with no leader is neither readable nor writable right now. */
export const hasLeader = (partition: KafkaPartition): boolean => partition.leader >= 0;
