import { useCallback } from "react";
import { getAllTopics, getTopicDetail, getTopicStats } from "@/api/topic";
import type { Destination } from "@/api/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";
import { partitionsOf, type KafkaPartition } from "@/mq/kafka/destinations";

/**
 * Every topic, internal ones included.
 *
 * The board filters rather than the driver, so toggling "show internal" costs
 * nothing: a cluster's internal topics are a handful and asking twice would
 * make the switch a round trip.
 */
export function useKafkaTopics(): BrokerData<Destination[]> {
  return useBrokerData(useCallback((connID: number) => getAllTopics(connID), []));
}

export interface KafkaTopicDetail {
  topic: Destination;
  partitions: KafkaPartition[];
  configs: Record<string, string>;
}

/**
 * One topic's partitions and full configuration.
 *
 * Loaded only when a row is selected: the partition list is a request per
 * topic, and the configuration is another. Paying that for every row of a
 * listing would make the page unusable on a cluster with a few hundred topics.
 */
export function useKafkaTopicDetail(name: string | null): BrokerData<KafkaTopicDetail> {
  return useBrokerData(
    useCallback(
      async (connID: number) => {
        if (name == null) throw new Error("no topic selected");
        const [topic, stats] = await Promise.all([
          getTopicDetail(connID, name),
          getTopicStats(connID, name),
        ]);
        return {
          topic,
          partitions: partitionsOf(stats),
          configs: configsOf(topic),
        };
      },
      [name],
    ),
    { enabled: name != null },
  );
}

/**
 * The topic's settings, as the broker reports them.
 *
 * A Kafka config key always contains a dot; this driver's own display keys
 * never do. Splitting on that is what lets the panel show the settings
 * document without also listing the attributes the list columns are built from.
 */
function configsOf(topic: Destination): Record<string, string> {
  const configs: Record<string, string> = {};
  for (const [key, value] of Object.entries(topic.attributes ?? {})) {
    if (key.includes(".") && value != null) configs[key] = value;
  }
  return configs;
}
