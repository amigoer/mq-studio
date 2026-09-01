/**
 * MQTT's view of the canonical cluster models.
 *
 * The keys are a contract with internal/driver/mqtt/cluster.go.
 *
 * What is absent matters as much as what is here, and more than it does for
 * any other family. MQTT reports no disk figure, no per-destination depth and
 * no rate that is not derived from a broker's own load average - so the
 * canonical fields carry the unknown sentinel and no board draws a number the
 * protocol cannot produce.
 *
 * Which figures arrive at all depends on the deployment. A plain Mosquitto
 * publishes a full $SYS tree and has no management API; a default EMQX refuses
 * the $SYS subscription and answers everything over HTTP. Reading through
 * `count` below means a board shows what this broker reports and says nothing
 * about the rest, rather than drawing a zero for both cases.
 */
import type { ClusterOverview, Node } from "@bindings/model/models";

const AttrBrokerVersion = "brokerVersion";
const AttrUptimeSeconds = "uptimeSeconds";
const AttrSysTopics = "sysTopics";

const AttrClientsConnected = "clientsConnected";
const AttrClientsTotal = "clientsTotal";
const AttrClientsMaximum = "clientsMaximum";
const AttrSharedSubscriptions = "sharedSubscriptions";
const AttrRetainedCount = "retainedCount";
const AttrMessagesReceived = "messagesReceived";
const AttrMessagesSent = "messagesSent";
const AttrMessagesDropped = "messagesDropped";
const AttrBytesReceived = "bytesReceived";
const AttrBytesSent = "bytesSent";
const AttrHeapCurrent = "heapCurrent";

const AttrNodeRole = "nodeRole";
const AttrNodeEdition = "nodeEdition";
const AttrNodeConnections = "nodeConnections";
const AttrNodeLive = "nodeLiveConnections";
const AttrNodeSessions = "nodeSessions";
const AttrMemoryUsed = "memoryUsed";
const AttrMemoryTotal = "memoryTotal";
const AttrLoad1 = "load1";

type Attributed = { attributes?: Record<string, string | undefined> };

function attr(source: Attributed, key: string): string {
  return source.attributes?.[key] ?? "";
}

/**
 * A counter the broker did not publish reads as unknown, not as zero.
 *
 * The difference is the whole point of the tiers: "this broker does not count
 * dropped messages" and "no messages were dropped" look identical once both
 * are rendered as 0, and only one of them means anything is healthy.
 */
function count(source: Attributed, key: string): number | null {
  const raw = attr(source, key);
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The overview's KPI row, straight from whichever tier answered. */
export interface MqttBrokerStats {
  version: string;
  uptimeSeconds: number | null;
  clientsConnected: number | null;
  clientsTotal: number | null;
  clientsMaximum: number | null;
  subscriptions: number | null;
  sharedSubscriptions: number | null;
  retained: number | null;
  messagesReceived: number | null;
  messagesSent: number | null;
  messagesDropped: number | null;
  bytesReceived: number | null;
  bytesSent: number | null;
  heapBytes: number | null;
  /** Topics, which only a management API can count. */
  topics: number | null;
}

export function brokerStats(overview: ClusterOverview): MqttBrokerStats {
  return {
    version: attr(overview, AttrBrokerVersion),
    uptimeSeconds: count(overview, AttrUptimeSeconds),
    clientsConnected: count(overview, AttrClientsConnected),
    clientsTotal: count(overview, AttrClientsTotal),
    clientsMaximum: count(overview, AttrClientsMaximum),
    // The canonical field is filled by both tiers, so it is read rather than
    // the attribute - and -1 there is the driver's not-reported marker.
    subscriptions: overview.subscriptions >= 0 ? overview.subscriptions : null,
    sharedSubscriptions: count(overview, AttrSharedSubscriptions),
    retained: count(overview, AttrRetainedCount),
    messagesReceived: count(overview, AttrMessagesReceived),
    messagesSent: count(overview, AttrMessagesSent),
    messagesDropped: count(overview, AttrMessagesDropped),
    bytesReceived: count(overview, AttrBytesReceived),
    bytesSent: count(overview, AttrBytesSent),
    heapBytes: count(overview, AttrHeapCurrent),
    topics: overview.destinations >= 0 ? overview.destinations : null,
  };
}

/**
 * The broker's own $SYS tree, as it published it.
 *
 * Shown verbatim rather than curated, because a broker publishes counters this
 * app has never heard of and dropping them would make the page less useful
 * than `mosquitto_sub -t '$SYS/#'`.
 */
export function sysTopics(overview: ClusterOverview): { topic: string; value: string }[] {
  const raw = attr(overview, AttrSysTopics);
  if (raw === "") return [];
  return raw
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab < 0
        ? { topic: line, value: "" }
        : { topic: line.slice(0, tab), value: line.slice(tab + 1) };
    });
}

/** One node's detail, where the broker names more than one. */
export interface MqttNodeDetail {
  role: string;
  edition: string;
  connections: number | null;
  liveConnections: number | null;
  sessions: number | null;
  memoryUsed: string;
  memoryTotal: string;
  load1: string;
  uptimeSeconds: number | null;
}

export function nodeDetail(node: Node): MqttNodeDetail {
  return {
    role: attr(node, AttrNodeRole),
    edition: attr(node, AttrNodeEdition),
    connections: count(node, AttrNodeConnections),
    liveConnections: count(node, AttrNodeLive),
    sessions: count(node, AttrNodeSessions),
    memoryUsed: attr(node, AttrMemoryUsed),
    memoryTotal: attr(node, AttrMemoryTotal),
    load1: attr(node, AttrLoad1),
    uptimeSeconds: count(node, AttrUptimeSeconds),
  };
}

/**
 * Uptime as a person reads it.
 *
 * Seconds rather than the milliseconds RabbitMQ's node page formats, because
 * that is the unit both MQTT tiers report in: Mosquitto publishes "3600
 * seconds" under $SYS and the driver converts EMQX's milliseconds on the way
 * out, so there is one unit to render here rather than two.
 */
export function formatUptimeSeconds(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
