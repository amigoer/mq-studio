import { useCallback } from "react";
import { getPulsarDeadLetterQueues, type DeadLetterQueue } from "@/api/pulsar";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * The dead-letter and retry topics in one namespace.
 *
 * Namespace-scoped because the walk is: there is no broker-side dead-letter
 * object to ask about, only names to recognise inside a namespace.
 */
export function usePulsarDeadLetters(namespace: string): BrokerData<DeadLetterQueue[]> {
  return useBrokerData(
    useCallback((connID: number) => getPulsarDeadLetterQueues(connID, namespace), [namespace]),
  );
}
