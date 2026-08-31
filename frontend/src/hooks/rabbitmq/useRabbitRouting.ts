import { useCallback } from "react";
import type { Binding, Destination } from "@/api/models";
import * as routingApi from "@/api/routing";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface RoutingSnapshot {
  exchanges: Destination[];
  bindings: Binding[];
}

/**
 * The exchanges and every binding in the virtual host, as one snapshot.
 *
 * They are read together because neither is useful alone: an exchange's row
 * shows how many bindings leave it, and a binding is meaningless without the
 * exchange it starts from. Reading them a moment apart would let a row count
 * bindings that no longer exist.
 */
export function useRabbitRouting(namespace = ""): BrokerData<RoutingSnapshot> {
  const load = useCallback(
    async (connID: number): Promise<RoutingSnapshot> => {
      const [exchanges, bindings] = await Promise.all([
        routingApi.getExchanges(connID, namespace),
        routingApi.getBindings(connID, namespace),
      ]);
      return { exchanges, bindings };
    },
    [namespace],
  );
  return useBrokerData(load);
}
