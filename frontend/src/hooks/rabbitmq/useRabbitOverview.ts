import { useCallback } from "react";
import type { Destination, Node } from "@/api/models";
import type { BrokerCensus } from "@/api/rabbitmq";
import * as clusterApi from "@/api/cluster";
import * as rabbitApi from "@/api/rabbitmq";
import * as topicApi from "@/api/topic";
import { present } from "@/api/client";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/** What the RabbitMQ overview reads from one connection. */
export interface RabbitOverviewSnapshot {
  census: BrokerCensus | null;
  nodes: Node[];
  queues: Destination[];
  lastUpdated: Date;
}

/**
 * The overview's three reads, settled together.
 *
 * A header that counts queues from one moment and messages from another is a
 * figure that was never true, so they land as one snapshot rather than
 * committing as each arrives.
 *
 * The queue list is what the busiest-queues table needs and the census cannot
 * give: /api/overview knows how many messages the broker holds, not which
 * queues hold them.
 */
export function useRabbitOverview(): BrokerData<RabbitOverviewSnapshot> {
  const load = useCallback(async (connID: number): Promise<RabbitOverviewSnapshot> => {
    const [census, cluster, queues] = await Promise.all([
      rabbitApi.getCensus(connID),
      clusterApi.getClusterView(connID),
      topicApi.getTopics(connID),
    ]);
    return {
      census,
      nodes: present(cluster?.nodes),
      queues,
      lastUpdated: new Date(),
    };
  }, []);

  return useBrokerData(load);
}
