import { useCallback } from "react";
import type { StreamClients } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Who is attached to one stream over the stream protocol.
 *
 * Scoped to a queue rather than a page, because it belongs in a detail panel:
 * it is only asked for when the selected queue is a stream, and the request
 * follows the selection.
 */
export function useRabbitStreamClients(
  vhost: string,
  name: string,
): BrokerData<StreamClients | null> {
  const load = useCallback(
    (connID: number) => rabbitApi.getStreamClients(connID, vhost, name),
    [vhost, name],
  );
  return useBrokerData(load, { enabled: name !== "" });
}
