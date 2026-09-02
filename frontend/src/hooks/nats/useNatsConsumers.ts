import { useCallback } from "react";
import type { Subscription } from "@/api/models";
import * as consumerApi from "@/api/consumer";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every consumer on every stream in the account.
 *
 * It goes through the canonical subscription API rather than a NATS one: a
 * consumer is a subscription, and what only JetStream has - its delivery and
 * acknowledgement policies, where it has got to in the stream - rides in the
 * attribute map.
 *
 * The driver assembles this by walking the streams and asking each, because
 * JetStream has no account-wide consumer listing. That is one request per
 * stream, which is why this is a page of its own rather than something the
 * streams board expands inline.
 */
export function useNatsConsumers(): BrokerData<Subscription[]> {
  const load = useCallback((connID: number) => consumerApi.getConsumerGroups(connID), []);
  return useBrokerData(load);
}
