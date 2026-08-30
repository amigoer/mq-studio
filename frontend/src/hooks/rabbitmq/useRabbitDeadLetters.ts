import { useCallback } from "react";
import type { DeadLetterQueue } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * The queues dead letters land in.
 *
 * Nothing on the broker marks a queue as one, so this is a topology walk
 * rather than a listing: every queue that declares a dead-letter exchange is
 * followed through that exchange's bindings to whatever it lands in.
 */
export function useRabbitDeadLetters(namespace = ""): BrokerData<DeadLetterQueue[]> {
  const load = useCallback(
    (connID: number) => rabbitApi.getDeadLetterQueues(connID, namespace),
    [namespace],
  );
  return useBrokerData(load);
}
