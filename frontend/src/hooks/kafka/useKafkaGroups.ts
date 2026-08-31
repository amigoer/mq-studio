import { useCallback } from "react";
import { getConsumeStats, getConsumerGroups } from "@/api/consumer";
import type { Subscription } from "@/api/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";
import { groupDetailOf, type KafkaGroupDetail } from "@/mq/kafka/subscriptions";

/** Every consumer group the cluster holds offsets for. */
export function useKafkaGroups(): BrokerData<Subscription[]> {
  return useBrokerData(useCallback((connID: number) => getConsumerGroups(connID), []));
}

/**
 * One group's members and its progress on every partition it holds.
 *
 * Loaded only when a row is selected. A group-level lag says a group is
 * behind; only these rows say which member is behind on which partition, which
 * is the difference between "scale up" and "one consumer is stuck".
 */
export function useKafkaGroupDetail(group: string | null): BrokerData<KafkaGroupDetail> {
  return useBrokerData(
    useCallback(
      async (connID: number) => {
        if (group == null) throw new Error("no group selected");
        return groupDetailOf(await getConsumeStats(connID, group));
      },
      [group],
    ),
    { enabled: group != null },
  );
}
