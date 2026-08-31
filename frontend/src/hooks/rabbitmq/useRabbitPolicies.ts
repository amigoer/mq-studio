import { useCallback } from "react";
import type { Policy, RuntimeParameter } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface PolicySnapshot {
  policies: Policy[];
  parameters: RuntimeParameter[];
}

/**
 * Policies and the runtime parameters beside them.
 *
 * Together because they are the same question asked twice: a policy is
 * configuration the broker stores and applies by pattern, and a runtime
 * parameter is configuration the broker stores for a plugin. Shovels and
 * federation upstreams are parameters, which is why seeing them here explains
 * where those pages' settings actually live.
 */
export function useRabbitPolicies(): BrokerData<PolicySnapshot> {
  const load = useCallback(async (connID: number): Promise<PolicySnapshot> => {
    const [policies, parameters] = await Promise.all([
      rabbitApi.getPolicies(connID),
      // Best effort: reading parameters needs the policymaker tag, and a user
      // without it should still see its policies.
      rabbitApi.getRuntimeParameters(connID).catch(() => [] as RuntimeParameter[]),
    ]);
    return { policies, parameters };
  }, []);
  return useBrokerData(load);
}
