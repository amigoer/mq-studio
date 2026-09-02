/**
 * NATS's view of a canonical node.
 *
 * The keys are a contract with internal/driver/nats/cluster.go.
 *
 * The one worth reading before anything else is `readVia`. A NATS server can
 * be asked about in two ways with very different reach: the monitoring
 * endpoint answers for the single server whose port the connection names, and
 * the system account fans a request out to every server in the cluster. A page
 * that could not tell them apart would show a cluster of one and call it the
 * cluster.
 */
import type { ClusterOverview, Node } from "@bindings/model/models";

const AttrServerID = "serverId";
const AttrGoVersion = "goVersion";
const AttrUptime = "uptime";
const AttrConnections = "connections";
const AttrTotalConns = "totalConnections";
const AttrSubscriptions = "subscriptions";
const AttrRoutes = "routes";
const AttrRemotes = "remotes";
const AttrLeafNodes = "leafNodes";
const AttrSlowConsumers = "slowConsumers";
const AttrMemoryBytes = "memoryBytes";
const AttrCores = "cores";
const AttrCPUPercent = "cpuPercent";
const AttrMaxPayload = "maxPayload";
const AttrMaxConns = "maxConnections";
const AttrAuthRequired = "authRequired";
const AttrTLSRequired = "tlsRequired";
const AttrJetStreamHere = "jetstreamEnabled";
const AttrJSMemory = "jetstreamMemory";
const AttrJSStorage = "jetstreamStorage";
const AttrMetaLeader = "metaLeader";
const AttrIsMetaLeader = "isMetaLeader";
const AttrSource = "readVia";

export const SOURCE_SYSTEM = "system";
export const SOURCE_MONITOR = "monitor";

function attr(node: Node | ClusterOverview, key: string): string | null {
  const value = node.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(node: Node | ClusterOverview, key: string): number | null {
  const raw = attr(node, key);
  if (raw == null) return null;
  const value = Number.parseFloat(raw);
  return Number.isNaN(value) ? null : value;
}

/**
 * Which source answered for this row.
 *
 * "monitor" means the listing is one server because that is all the connection
 * can reach, not because the cluster has one - and the page has to say so, or
 * a three-server cluster reads as a single node.
 */
export const readVia = (node: Node | ClusterOverview): string | null => attr(node, AttrSource);

export const isFromOneServerOnly = (node: Node | ClusterOverview): boolean =>
  readVia(node) === SOURCE_MONITOR;

export const serverId = (node: Node): string | null => attr(node, AttrServerID);
export const goVersion = (node: Node): string | null => attr(node, AttrGoVersion);
export const uptime = (node: Node): string | null => attr(node, AttrUptime);

export const connections = (node: Node | ClusterOverview): number | null =>
  number(node, AttrConnections);
export const totalConnections = (node: Node): number | null => number(node, AttrTotalConns);
export const subscriptions = (node: Node | ClusterOverview): number | null =>
  number(node, AttrSubscriptions);

/**
 * How many routes this server holds, and to how many peers.
 *
 * Two numbers because they are not the same: NATS opens a pool of connections
 * per peer, so eight routes to two peers is ordinary rather than a sign of
 * anything. Remotes is the one that answers "has the cluster formed".
 */
export const routes = (node: Node): number | null => number(node, AttrRoutes);
export const remotes = (node: Node): number | null => number(node, AttrRemotes);

export const leafNodes = (node: Node): number | null => number(node, AttrLeafNodes);

/**
 * Clients the server had to disconnect for not keeping up.
 *
 * A running total since the server started, not a current state. It is worth a
 * column because it is the one figure that says a consumer somewhere is too
 * slow for what is being published at it.
 */
export const slowConsumers = (node: Node | ClusterOverview): number | null =>
  number(node, AttrSlowConsumers);

export const memoryBytes = (node: Node): number | null => number(node, AttrMemoryBytes);
export const cores = (node: Node): number | null => number(node, AttrCores);
export const cpuPercent = (node: Node): number | null => number(node, AttrCPUPercent);
export const maxPayload = (node: Node): number | null => number(node, AttrMaxPayload);
export const maxConnections = (node: Node): number | null => number(node, AttrMaxConns);

export const authRequired = (node: Node): boolean => attr(node, AttrAuthRequired) === "true";
export const tlsRequired = (node: Node): boolean => attr(node, AttrTLSRequired) === "true";

/**
 * Whether this server runs JetStream at all.
 *
 * Per server rather than per cluster: a cluster can be mixed, and a stream can
 * only be placed on the servers that have it. A page that assumed the cluster
 * was uniform would explain nothing about why a stream would not go to three
 * replicas.
 */
export const hasJetStream = (node: Node): boolean => attr(node, AttrJetStreamHere) === "true";
export const jetStreamMemory = (node: Node): number | null => number(node, AttrJSMemory);
export const jetStreamStorage = (node: Node): number | null => number(node, AttrJSStorage);

/**
 * Which server leads the JetStream metadata group.
 *
 * One server in the cluster carries the stream and consumer assignments. It is
 * worth marking because a cluster with no meta leader has JetStream running
 * and answering nothing.
 */
export const metaLeader = (node: Node | ClusterOverview): string | null =>
  attr(node, AttrMetaLeader);
export const isMetaLeader = (node: Node): boolean => attr(node, AttrIsMetaLeader) === "true";
