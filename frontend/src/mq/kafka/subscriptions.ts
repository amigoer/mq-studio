/**
 * Kafka's view of a canonical subscription.
 *
 * The keys are a contract with internal/driver/kafka/group.go.
 *
 * What is absent matters as much as what is here. There is no consume rate:
 * Kafka's admin protocol reports none - it is a JMX metric on the consumer, not
 * something the cluster knows - so the canonical rate field carries the unknown
 * sentinel and no board draws a per-second figure.
 */
import type { Subscription } from "@bindings/model/models";

const AttrState = "state";
const AttrProtocol = "protocol";
const AttrAssignor = "assignor";
const AttrCoordinator = "coordinator";
const AttrTopics = "topics";
const AttrHasMembers = "hasMembers";

/** The unknown sentinel every canonical numeric field uses. */
export const UNKNOWN = -1;

function attr(group: Subscription, key: string): string {
  return group.attributes?.[key] ?? "";
}

export const state = (group: Subscription): string => attr(group, AttrState);
export const protocolType = (group: Subscription): string => attr(group, AttrProtocol);
export const assignor = (group: Subscription): string => attr(group, AttrAssignor);
export const coordinator = (group: Subscription): string => attr(group, AttrCoordinator);

/** The topics this group has committed offsets on. */
export const topics = (group: Subscription): string[] => {
  const raw = attr(group, AttrTopics);
  return raw === "" ? [] : raw.split(",");
};

/**
 * Whether anything is connected to the group right now.
 *
 * The single most important thing about a Kafka group before any operation on
 * it: offsets cannot be written while members hold the partitions, so this is
 * what decides whether a reset can be offered at all.
 */
export const hasMembers = (group: Subscription): boolean =>
  attr(group, AttrHasMembers) === "true";

/**
 * Records the group still has to read.
 *
 * Null when nothing could be measured, which must not read as caught up: a
 * group with an unanswerable lag and one with nothing left to do are opposite
 * situations.
 */
export const totalLag = (group: Subscription): number | null =>
  group.backlog === UNKNOWN ? null : group.backlog;

/**
 * A group with committed offsets and nothing connected.
 *
 * Either between deployments or a consumer that died and left a backlog
 * growing behind it, and nothing in the protocol says which - so the board
 * names the state and lets the reader decide.
 */
export const isEmpty = (group: Subscription): boolean => state(group) === "Empty";

/** Mid-rebalance: the assignment is moving and lag figures are in flux. */
export const isRebalancing = (group: Subscription): boolean =>
  state(group) === "PreparingRebalance" || state(group) === "CompletingRebalance";

/** One partition's progress, as SubscriptionStats sends it. */
export interface KafkaGroupPartition {
  topic: string;
  partition: number;
  /** Empty when nothing holds this partition. */
  member: string;
  committed: number;
  start: number;
  end: number;
  lag: number;
}

/** One member of the group. */
export interface KafkaGroupMember {
  memberId: string;
  clientId: string;
  clientHost: string;
  instanceId: string;
  assigned: string[];
}

export interface KafkaGroupDetail {
  partitions: KafkaGroupPartition[];
  members: KafkaGroupMember[];
}

/** Reads the rows out of what SubscriptionStats returned. */
export function groupDetailOf(stats: Record<string, unknown> | null): KafkaGroupDetail {
  if (stats == null) return { partitions: [], members: [] };
  const partitions = Array.isArray(stats.partitions) ? stats.partitions : [];
  const members = Array.isArray(stats.members) ? stats.members : [];

  return {
    partitions: partitions.map((row) => {
      const source = row as Record<string, unknown>;
      return {
        topic: String(source.topic ?? ""),
        partition: Number(source.partition ?? 0),
        member: String(source.member ?? ""),
        committed: Number(source.committed ?? UNKNOWN),
        start: Number(source.start ?? UNKNOWN),
        end: Number(source.end ?? UNKNOWN),
        lag: Number(source.lag ?? UNKNOWN),
      };
    }),
    members: members.map((row) => {
      const source = row as Record<string, unknown>;
      return {
        memberId: String(source.memberId ?? ""),
        clientId: String(source.clientId ?? ""),
        clientHost: String(source.clientHost ?? ""),
        instanceId: String(source.instanceId ?? ""),
        assigned: Array.isArray(source.assigned) ? source.assigned.map(String) : [],
      };
    }),
  };
}

/**
 * Whether the group has ever committed on this partition.
 *
 * -1 is Kafka's "no position", and it is the opposite end of the log from
 * offset 0: a group that has never read a partition is not a group sitting at
 * its start.
 */
export const hasCommitted = (partition: KafkaGroupPartition): boolean =>
  partition.committed >= 0;
