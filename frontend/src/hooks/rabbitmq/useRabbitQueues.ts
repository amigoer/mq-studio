import { useCallback } from "react";
import type { Destination } from "@/api/models";
import * as topicApi from "@/api/topic";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every queue in the connection's virtual host.
 *
 * It goes through the canonical destination API rather than a RabbitMQ one:
 * a queue is a destination, one request answers the whole list, and the
 * family-specific detail rides in the attribute map.
 */
export function useRabbitQueues(): BrokerData<Destination[]> {
  const load = useCallback((connID: number) => topicApi.getTopics(connID), []);
  return useBrokerData(load);
}
