import { KafkaService } from "@bindings/bridge";
import type { KafkaTopicInput } from "@bindings/bridge/models";
import { required } from "./client";

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
