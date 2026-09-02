import { useCallback } from "react";
import { getConsumerGroups } from "@/api/consumer";
import {
  getPulsarSubscriptionClients,
  getPulsarSubscriptionStats,
  type SubscriptionClient,
} from "@/api/pulsar";
import type { Subscription } from "@/api/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every subscription in the connection's namespace.
 *
 * This one does go through the canonical consumer API, because the canonical
 * port fits: ListSubscriptions takes no scope on any family, and the driver
 * reads the connection's own namespace - the same one every other page opens
 * on. Only the per-subscription calls need the topic, and those are Pulsar's.
 *
 * It is the most expensive listing in the app: a Pulsar subscription belongs
 * to a topic and is named only within it, so enumerating them means reading
 * every topic's stats. The driver bounds the fan-out; this leaves the refresh
 * on the default timer rather than making it faster.
 */
export function usePulsarSubscriptions(): BrokerData<Subscription[]> {
  return useBrokerData(useCallback((connID: number) => getConsumerGroups(connID), []));
}

export interface PulsarSubscriptionDetail {
  stats: Record<string, unknown>;
  clients: SubscriptionClient[];
}

/** One subscription's figures and the consumers attached to it. */
export function usePulsarSubscriptionDetail(
  topic: string | null,
  subscription: string | null,
): BrokerData<PulsarSubscriptionDetail> {
  return useBrokerData(
    useCallback(
      async (connID: number) => {
        if (topic == null || subscription == null) throw new Error("nothing selected");
        const [stats, clients] = await Promise.all([
          getPulsarSubscriptionStats(connID, topic, subscription),
          getPulsarSubscriptionClients(connID, topic, subscription),
        ]);
        return { stats, clients };
      },
      [topic, subscription],
    ),
    { enabled: topic != null && subscription != null, refreshMs: null },
  );
}
