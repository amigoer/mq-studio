import { useCallback } from "react";
import type { Subscription } from "@/api/models";
import * as consumerApi from "@/api/consumer";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every consumer group on every stream the key pattern matches.
 *
 * It goes through the canonical consumer API rather than a Redis one: a group
 * is a subscription, one request answers the whole list, and what only Redis
 * has rides in the attribute map. Creating and deleting do not - the canonical
 * service addresses a group by name and a broker address, and a Redis group's
 * name means nothing without the stream it is on.
 */
export function useRedisGroups(): BrokerData<Subscription[]> {
  const load = useCallback((connID: number) => consumerApi.getConsumerGroups(connID), []);
  return useBrokerData(load);
}
