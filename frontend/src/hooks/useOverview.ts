import { useCallback } from "react";
import type { ClusterView, Node, Subscription, Destination } from "@/api/models";
import * as clusterApi from "@/api/cluster";
import * as consumerApi from "@/api/consumer";
import * as topicApi from "@/api/topic";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";
import { present } from "@/api/client";

/** Everything the overview and the alert rules read from one connection. */
export interface OverviewSnapshot {
  cluster: ClusterView | null;
  nodes: Node[];
  topics: Destination[];
  consumerGroups: Subscription[];
  lastUpdated: Date;
}

export const EMPTY_OVERVIEW: OverviewSnapshot = {
  cluster: null,
  nodes: [],
  topics: [],
  consumerGroups: [],
  lastUpdated: new Date(0),
};

/**
 * The overview's three reads, as one snapshot.
 *
 * They are settled together rather than committed as each lands: a header that
 * counts brokers from one moment and topics from another is a figure that was
 * never true. The cluster view already carries its nodes, so asking Brokers as
 * well would run the topology query twice and double-sample the TPS history.
 *
 * Consumer groups are allowed to fail on their own. Enriching them means one
 * request per group, which is the slowest and least reliable of the three, and
 * losing the whole page to it would be worse than an overview with no group
 * figures.
 */
export function useOverview(): BrokerData<OverviewSnapshot> {
  const load = useCallback(async (connID: number): Promise<OverviewSnapshot> => {
    const [cluster, topics, groups] = await Promise.all([
      clusterApi.getClusterView(connID),
      topicApi.getTopics(connID),
      consumerApi.getConsumerGroups(connID).catch(() => [] as Subscription[]),
    ]);
    return {
      cluster,
      nodes: present(cluster?.nodes),
      topics,
      consumerGroups: groups,
      lastUpdated: new Date(),
    };
  }, []);

  return useBrokerData(load);
}
