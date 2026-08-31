import { useCallback } from "react";
import { getKafkaQuotas } from "@/api/kafka";
import type { QuotaView } from "@bindings/bridge/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/** The limits attached to clients rather than to topics. */
export function useKafkaQuotas(): BrokerData<QuotaView> {
  return useBrokerData(useCallback((connID: number) => getKafkaQuotas(connID), []));
}
