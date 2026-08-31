import { useCallback } from "react";
import { getKafkaAccessControl } from "@/api/kafka";
import type { AccessView } from "@bindings/bridge/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * The cluster's ACLs and the users it stores, in one request.
 *
 * One request because the two are read together and separately they can
 * disagree: a page that fetched them apart could show a rule for a user the
 * same refresh says does not exist.
 */
export function useKafkaAccess(): BrokerData<AccessView> {
  return useBrokerData(useCallback((connID: number) => getKafkaAccessControl(connID), []));
}
