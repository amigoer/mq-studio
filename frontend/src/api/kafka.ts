import { KafkaService } from "@bindings/bridge";
import type { KafkaTopicInput } from "@bindings/bridge/models";

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
