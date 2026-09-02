import { useCallback } from "react";
import {
  getPulsarNamespaceGrants,
  getPulsarTopicGrants,
  type NamespacePermission,
  type TopicPermission,
} from "@/api/pulsar";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/** Every role granted access to one namespace. */
export function usePulsarNamespaceGrants(
  namespace: string,
): BrokerData<NamespacePermission[]> {
  return useBrokerData(
    useCallback((connID: number) => getPulsarNamespaceGrants(connID, namespace), [namespace]),
  );
}

/**
 * Every per-topic grant in the connection's namespace.
 *
 * A separate read because Pulsar stores them separately - the namespace's own
 * grants come back with its policies, and each topic's come from its own
 * endpoint - so this one costs a request per topic and is not part of the
 * page's first paint.
 */
export function usePulsarTopicGrants(enabled: boolean): BrokerData<TopicPermission[]> {
  return useBrokerData(
    useCallback((connID: number) => getPulsarTopicGrants(connID), []),
    { enabled },
  );
}
