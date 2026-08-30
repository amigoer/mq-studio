import { useCallback } from "react";
import type { ClientChannel, ClientConnection } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface ClientSnapshot {
  connections: ClientConnection[];
  channels: ClientChannel[];
}

/**
 * The connections and the channels inside them, as one snapshot.
 *
 * Read together because a connection row counts its own channels and the
 * channel rows have to agree with that count. Reading them a moment apart
 * would let a connection claim four channels while three are listed.
 */
export function useRabbitClients(namespace = ""): BrokerData<ClientSnapshot> {
  const load = useCallback(
    async (connID: number): Promise<ClientSnapshot> => {
      const [connections, channels] = await Promise.all([
        rabbitApi.getClientConnections(connID, namespace),
        rabbitApi.getClientChannels(connID, namespace),
      ]);
      return { connections, channels };
    },
    [namespace],
  );
  return useBrokerData(load);
}
