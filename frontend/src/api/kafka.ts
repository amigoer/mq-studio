import { KafkaService } from "@bindings/bridge";
import type { KafkaTopicInput } from "@bindings/bridge/models";
import { present, required } from "./client";
import type { AccessPrincipalSpec, AccessRule, QuotaEntity } from "@bindings/model/models";

export type { KafkaTopicInput };

/**
 * The Kafka-only surface.
 *
 * Reading topics, groups and brokers is not here: those are destinations,
 * subscriptions and nodes, and api/topic.ts, api/consumer.ts and api/cluster.ts
 * already answer them for every family. What lives here is what the canonical
 * shape cannot express - starting with creating a topic, which needs a
 * partition count, a replication factor and a configuration document rather
 * than the broker address and queue counts TopicService.Create asks for.
 */
export const createKafkaTopic = (connID: number, input: KafkaTopicInput): Promise<void> =>
  KafkaService.CreateTopic(connID, input);

/**
 * Changes only the settings it is given. An empty value puts one back to the
 * cluster default rather than setting it to the empty string.
 */
export const alterKafkaTopicConfigs = (
  connID: number,
  name: string,
  configs: Record<string, string>,
): Promise<void> => KafkaService.AlterTopicConfigs(connID, name, configs);

/**
 * Removes a topic and everything in it.
 *
 * Resolves once the cluster agrees the topic is gone rather than once the
 * delete is accepted, so the list a board re-reads afterwards does not still
 * carry it.
 */
export const deleteKafkaTopic = (connID: number, name: string): Promise<void> =>
  KafkaService.DeleteTopic(connID, name);

/** Where an offset reset moves a group to. Kafka has five, and so does this. */
export type KafkaOffsetTarget = "earliest" | "latest" | "timestamp" | "offset" | "shift";

export interface KafkaOffsetReset {
  group: string;
  topic: string;
  /** Empty means every partition of the topic. */
  partitions: number[];
  target: KafkaOffsetTarget;
  /** Milliseconds, for the timestamp target. */
  timestamp: number;
  /** The offset for the offset target, the signed delta for shift. */
  value: number;
}

/**
 * Writes a consumer group's committed offsets.
 *
 * Kafka refuses this while the group has live members, and that refusal
 * reaches the user as-is: the fix is to stop the consumers, and saying so is
 * more use than a reset a running consumer would overwrite moments later.
 */
export const resetKafkaGroupOffsets = (
  connID: number,
  input: KafkaOffsetReset,
): Promise<void> => KafkaService.ResetGroupOffsets(connID, input);

/** Forgets a group's position on some topics without deleting the group. */
export const deleteKafkaGroupOffsets = (
  connID: number,
  group: string,
  topics: string[],
): Promise<void> => KafkaService.DeleteGroupOffsets(connID, group, topics);

/** Copies one group's positions onto another. An empty topic copies them all. */
export const cloneKafkaGroupOffsets = (
  connID: number,
  from: string,
  to: string,
  topic: string,
): Promise<void> => KafkaService.CloneGroupOffsets(connID, from, to, topic);

/** Removes a consumer group and the offsets it holds. */
export const deleteKafkaGroup = (connID: number, group: string): Promise<void> =>
  KafkaService.DeleteGroup(connID, group);

/** Where a cluster's disk has gone: one round trip for the storage tab. */
export const getKafkaLogDirs = (connID: number) =>
  KafkaService.LogDirs(connID).then(required);

/**
 * The transactional producers the cluster is tracking.
 *
 * Read on demand rather than with the cluster header: it is a request to the
 * coordinators, and it matters only while somebody is looking for the one
 * transaction that has stopped a pipeline.
 */
export const getKafkaTransactions = (connID: number) =>
  KafkaService.Transactions(connID).then(required);

import type { KafkaAcks } from "@/design/boards/producer/producerKafkaDraft";

export interface KafkaRecordInput {
  topic: string;
  /** -1 lets the key decide, which is what ordering by key depends on. */
  partition: number;
  /** A record with no key at all is spread; one with an empty key is pinned. */
  hasKey: boolean;
  key: string;
  value: string;
  headers: Record<string, string>;
  /** Milliseconds; zero stamps it now. */
  timestamp: number;
  acks: KafkaAcks;
  count: number;
}

/** Publishes and reports the partition and offset the record landed on. */
export const sendKafkaRecord = (connID: number, input: KafkaRecordInput) =>
  KafkaService.SendRecord(connID, input).then(required);

/** The access control page in one answer. */
export const getKafkaAccessControl = (connID: number) =>
  KafkaService.AccessControl(connID).then(required);

export const putKafkaAccessRule = (connID: number, rule: AccessRule): Promise<void> =>
  KafkaService.PutAccessRule(connID, rule);

export const removeKafkaAccessRule = (connID: number, subject: string): Promise<void> =>
  KafkaService.RemoveAccessRule(connID, subject);

/** Creates or updates a SCRAM user. The password never comes back. */
export const putKafkaPrincipal = (
  connID: number,
  spec: AccessPrincipalSpec,
): Promise<void> => KafkaService.PutPrincipal(connID, spec);

export const removeKafkaPrincipal = (connID: number, name: string): Promise<void> =>
  KafkaService.RemovePrincipal(connID, name);

/**
 * Empties a topic without deleting it.
 *
 * The offsets do not restart: a consumer that was at 900 stays at 900 and is
 * simply caught up, which is what makes this safe on a topic something reads.
 */
export const truncateKafkaTopic = (connID: number, name: string): Promise<void> =>
  KafkaService.TruncateTopic(connID, name);

/** Takes a batch off the head of each partition; returns how many it removed. */
export const dropOldestKafkaRecords = (
  connID: number,
  name: string,
  limit: number,
): Promise<number> => KafkaService.DropOldestRecords(connID, name, limit);

/** Puts each partition's leadership back on the first broker in its replica list. */
export const electKafkaPreferredLeaders = (connID: number): Promise<void> =>
  KafkaService.ElectPreferredLeaders(connID);

/** The partitions being moved between brokers right now. */
export const getKafkaReassignments = (connID: number) =>
  KafkaService.Reassignments(connID).then(present);

/** Rewrites where a partition's replicas live. The first broker leads. */
export const reassignKafkaPartition = (
  connID: number,
  topic: string,
  partition: number,
  brokers: number[],
): Promise<void> => KafkaService.Reassign(connID, topic, partition, brokers);

/** Stops a move in flight, leaving the partition wherever it has got to. */
export const cancelKafkaReassignment = (
  connID: number,
  topic: string,
  partition: number,
): Promise<void> => KafkaService.CancelReassignment(connID, topic, partition);

/** The quotas page in one answer. */
export const getKafkaQuotas = (connID: number) =>
  KafkaService.Quotas(connID).then(required);

/**
 * Sets the limits in `set` and removes the keys in `remove`.
 *
 * Removing is not setting zero: zero is a real quota that throttles a client to
 * nothing, so an operator who meant "no limit" and got that would have stopped
 * the thing they were trying to unblock.
 */
export const alterKafkaQuota = (
  connID: number,
  entity: QuotaEntity[],
  set: Record<string, number>,
  remove: string[],
): Promise<void> => KafkaService.AlterQuota(connID, entity, set, remove);

/** Clears every limit on an entity, which is how a quota stops existing. */
export const removeKafkaQuota = (
  connID: number,
  entity: QuotaEntity[],
  keys: string[],
): Promise<void> => KafkaService.RemoveQuota(connID, entity, keys);
