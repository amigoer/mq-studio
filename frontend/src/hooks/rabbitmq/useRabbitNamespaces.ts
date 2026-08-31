import { useCallback } from "react";
import type { Namespace } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every virtual host on the broker, not only the one the connection opened.
 *
 * The other pages are scoped to the connection's own vhost, because that is
 * what a connection is bound to. This one is deliberately broker-wide: it is
 * where an operator sees that a vhost exists at all.
 */
export function useRabbitNamespaces(): BrokerData<Namespace[]> {
  const load = useCallback((connID: number) => rabbitApi.getNamespaces(connID), []);
  return useBrokerData(load);
}
