/**
 * Pulsar's view of the canonical cluster models.
 *
 * The keys are a contract with internal/driver/pulsar/cluster.go.
 *
 * What is absent matters as much as what is here. Pulsar brokers keep no
 * messages of their own - BookKeeper does - so no broker reports a disk figure
 * and the canonical DiskUsage carries the unknown sentinel on every node. And
 * the rates come from the load manager, which describes only the broker that
 * answered the request: behind a load balancer that is one of several, so
 * every other row reports unknown rather than borrowing its numbers.
 *
 * What Pulsar has instead is bundles. A namespace is split into them, each is
 * owned by exactly one broker, and an uneven spread is what an unbalanced
 * cluster looks like well before it shows up in the traffic.
 */
import type { ClusterOverview, Node } from "@bindings/model/models";
import {
  AttrClusterBrokerServiceURL,
  AttrClusterMetadataStore,
  AttrClusterName,
  AttrClusterServiceURL,
  AttrNodeBundles,
  AttrNodeConsumers,
  AttrNodeCPUPercent,
  AttrNodeDirectMemoryPercent,
  AttrNodeLeader,
  AttrNodeMemoryPercent,
  AttrNodeProducers,
  AttrNodeServiceURL,
  AttrNodeTopics,
  AttrNodeVersion,
  attr,
  count,
} from "./attributes";

/**
 * Whether this broker holds load-manager leadership.
 *
 * Pulsar brokers are peers - there is no master and slave - so this is the
 * only role a node has, and it is worth showing because the leader is the one
 * deciding where bundles go.
 */
export const isLeader = (node: Node): boolean => attr(node, AttrNodeLeader) === "true";

export const brokerServiceURL = (node: Node): string => attr(node, AttrNodeServiceURL);
export const brokerVersion = (node: Node): string => attr(node, AttrNodeVersion);

export const cpuPercent = (node: Node): number | null => count(node, AttrNodeCPUPercent);
export const memoryPercent = (node: Node): number | null => count(node, AttrNodeMemoryPercent);
export const directMemoryPercent = (node: Node): number | null =>
  count(node, AttrNodeDirectMemoryPercent);

export const bundleCount = (node: Node): number | null => count(node, AttrNodeBundles);
export const topicCount = (node: Node): number | null => count(node, AttrNodeTopics);
export const producerCount = (node: Node): number | null => count(node, AttrNodeProducers);
export const consumerCount = (node: Node): number | null => count(node, AttrNodeConsumers);

/**
 * Whether the load manager described this broker at all.
 *
 * The rows that it did not are not broken - they are brokers this connection
 * cannot ask - and the board says so instead of drawing a row of dashes with
 * no explanation.
 */
export const isDescribed = (node: Node): boolean => brokerVersion(node) !== "";

export const clusterName = (overview: ClusterOverview): string => attr(overview, AttrClusterName);
export const clusterServiceURL = (overview: ClusterOverview): string =>
  attr(overview, AttrClusterServiceURL);
export const clusterBrokerServiceURL = (overview: ClusterOverview): string =>
  attr(overview, AttrClusterBrokerServiceURL);
export const metadataStore = (overview: ClusterOverview): string =>
  attr(overview, AttrClusterMetadataStore);
