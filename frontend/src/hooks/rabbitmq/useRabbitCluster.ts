import { useCallback } from "react";
import type { Node } from "@/api/models";
import type {
  BrokerCensus,
  DeprecatedFeature,
  FeatureFlag,
  HealthCheck,
  ResourceAlarm,
} from "@/api/rabbitmq";
import * as clusterApi from "@/api/cluster";
import * as rabbitApi from "@/api/rabbitmq";
import { present } from "@/api/client";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * The health payload with its slices flattened.
 *
 * The bindings model every Go pointer as nullable, so the raw shape is
 * arrays-of-maybe. Boards should not each repeat that check, so it is settled
 * once here.
 */
export interface RabbitHealth {
  checks: HealthCheck[];
  alarms: ResourceAlarm[];
  featureFlags: FeatureFlag[];
  deprecatedFeatures: DeprecatedFeature[];
}

export interface RabbitClusterSnapshot {
  nodes: Node[];
  census: BrokerCensus | null;
  health: RabbitHealth | null;
}

/**
 * The nodes, the broker's identity and what it says about its own health.
 *
 * Health is allowed to fail on its own. It is six separate endpoint calls, the
 * slowest and least reliable of the three, and losing the node list to it
 * would be worse than a cluster page with no check results - the node list is
 * what an operator came for.
 */
export function useRabbitCluster(): BrokerData<RabbitClusterSnapshot> {
  const load = useCallback(async (connID: number): Promise<RabbitClusterSnapshot> => {
    const [cluster, census, health] = await Promise.all([
      clusterApi.getClusterView(connID),
      rabbitApi.getCensus(connID),
      rabbitApi.getHealth(connID).catch(() => null),
    ]);
    return {
      nodes: present(cluster?.nodes),
      census,
      health:
        health == null
          ? null
          : {
              checks: present(health.checks),
              alarms: present(health.alarms),
              featureFlags: present(health.featureFlags),
              deprecatedFeatures: present(health.deprecatedFeatures),
            },
    };
  }, []);

  return useBrokerData(load);
}
