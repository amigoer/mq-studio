/**
 * The attribute keys internal/driver/pulsar puts on the canonical models.
 *
 * Declared once, here, and read by nothing outside src/mq/pulsar. A Go test -
 * TestAttributeKeysMatchTheFrontendModule - reads this file and asserts the
 * two sets are equal in both directions, because a key renamed on one side is
 * a column that quietly reads empty on the other, which looks like a cluster
 * with nothing to report rather than a bug.
 */

/** Node. */
export const AttrNodeLeader = "pulsarLeader";
export const AttrNodeServiceURL = "pulsarServiceUrl";
export const AttrNodeVersion = "pulsarBrokerVersion";
export const AttrNodeCPUPercent = "pulsarCpuPercent";
export const AttrNodeMemoryPercent = "pulsarMemoryPercent";
export const AttrNodeDirectMemoryPercent = "pulsarDirectMemoryPercent";
export const AttrNodeBundles = "pulsarBundles";
export const AttrNodeTopics = "pulsarTopics";
export const AttrNodeProducers = "pulsarProducers";
export const AttrNodeConsumers = "pulsarConsumers";

/** ClusterOverview. */
export const AttrClusterName = "pulsarCluster";
export const AttrClusterServiceURL = "pulsarClusterWebServiceUrl";
export const AttrClusterBrokerServiceURL = "pulsarClusterBrokerServiceUrl";
export const AttrClusterMetadataStore = "pulsarMetadataStore";

type Attributed = { attributes?: Record<string, string | undefined> };

/** A driver-specific string, or "" when the driver did not report it. */
export function attr(source: Attributed, key: string): string {
  return source.attributes?.[key] ?? "";
}

/**
 * A counter the driver did not report reads as null, not as zero.
 *
 * The difference is the point: "this broker carries no topics" and "nobody
 * asked" look identical once both render as 0, and only one of them is a fact
 * about the cluster.
 */
export function count(source: Attributed, key: string): number | null {
  const raw = attr(source, key);
  if (raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}
