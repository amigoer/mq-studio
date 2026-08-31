import { useCallback } from "react";
import type { FederationUpstream, Shovel } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface ReplicationSnapshot {
  shovels: Shovel[];
  upstreams: FederationUpstream[];
}

/**
 * The two ways messages move between brokers.
 *
 * One page because they answer the same question from two directions - what is
 * this broker exchanging with another, and is it working - even though they do
 * it differently: a shovel moves messages from somewhere to somewhere, and
 * federation keeps two brokers' exchanges or queues in step continuously.
 *
 * Federation is allowed to fail on its own: the two are separate plugins and
 * one can be enabled without the other.
 */
export function useRabbitReplication(): BrokerData<ReplicationSnapshot> {
  const load = useCallback(async (connID: number): Promise<ReplicationSnapshot> => {
    const [shovels, upstreams] = await Promise.all([
      rabbitApi.getShovels(connID),
      rabbitApi.getFederationUpstreams(connID).catch(() => [] as FederationUpstream[]),
    ]);
    return { shovels, upstreams };
  }, []);
  return useBrokerData(load);
}
