import { useCallback } from "react";
import type { ClientConnection } from "@/api/models";
import * as natsApi from "@/api/nats";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every connection the cluster is holding.
 *
 * Through the NATS service, because client inspection has no canonical one -
 * MQTT and RabbitMQ each expose their own for the same reason. What only NATS
 * has, the subjects a connection is subscribed to and which server holds it,
 * rides in the attribute map.
 *
 * How many servers are covered depends on which tier answered: /connz reports
 * the connections on the one server it belongs to, and the system account fans
 * out to all of them. On a three-server cluster reached through monitoring
 * alone that is two thirds of the connections missing, which the servers page
 * says and this one inherits.
 */
export function useNatsClients(): BrokerData<ClientConnection[]> {
  const load = useCallback((connID: number) => natsApi.connections(connID, ""), []);
  return useBrokerData(load);
}
