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
 * Either half is allowed to fail on its own: they are separate plugins and one
 * can be enabled without the other, so a broker with only federation must
 * still draw its upstreams rather than fail the page on the shovel it has no
 * plugin for. Both failing is a real failure and reaches the board.
 */
export function useRabbitReplication(): BrokerData<ReplicationSnapshot> {
  const load = useCallback(
    async (connID: number): Promise<ReplicationSnapshot> =>
      mergeReplication(
        await Promise.all([
          rabbitApi.getShovels(connID).catch((error: unknown) => error),
          rabbitApi.getFederationUpstreams(connID).catch((error: unknown) => error),
        ]),
      ),
    [],
  );
  return useBrokerData(load);
}

/**
 * The two halves, whichever of them answered.
 *
 * A half that failed contributes an empty list rather than taking the page
 * with it; both failing is a real failure and is rethrown so the board draws
 * it. Exported for its own test - the interesting case is a broker with one
 * plugin, which no fixture can be built out of the hook itself.
 */
export function mergeReplication([shovels, upstreams]: [
  Shovel[] | unknown,
  FederationUpstream[] | unknown,
]): ReplicationSnapshot {
  if (!Array.isArray(shovels) && !Array.isArray(upstreams)) throw shovels;
  return {
    shovels: Array.isArray(shovels) ? (shovels as Shovel[]) : [],
    upstreams: Array.isArray(upstreams) ? (upstreams as FederationUpstream[]) : [],
  };
}
