/**
 * MQTT's view of the canonical client connection.
 *
 * The keys are a contract with internal/driver/mqtt/management.go.
 *
 * A client here is a session rather than a socket, and that is the difference
 * the page exists to show: an MQTT session can outlive the connection that
 * made it, holding queued messages and counting against the broker with
 * nothing connected. The canonical model has no field for that, so the session
 * state arrives through the attribute bag.
 */
import type { ClientConnection } from "@bindings/model/models";

const AttrCleanStart = "cleanStart";
const AttrSessionExpiry = "sessionExpiry";
const AttrSubscriptions = "subscriptions";
const AttrInflight = "inflight";
const AttrQueued = "queued";
const AttrQueueDropped = "queueDropped";
const AttrListener = "listener";
const AttrDurable = "durable";
const AttrDisconnectedAt = "disconnectedAt";

type Attributed = { attributes?: Record<string, string | undefined> };

function attr(source: Attributed, key: string): string {
  return source.attributes?.[key] ?? "";
}

function count(source: Attributed, key: string): number | null {
  const raw = attr(source, key);
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface MqttClientSession {
  /** True while a socket is open. False is a session with nobody on it. */
  connected: boolean;
  /**
   * True when the session survives the connection. Together with connected
   * above this is the state worth reading: durable and disconnected is a
   * session queueing messages for a client that is not there.
   */
  durable: boolean;
  cleanStart: boolean;
  sessionExpirySec: number | null;
  subscriptions: number | null;
  inflight: number | null;
  queued: number | null;
  /** Messages the broker gave up queueing. A silent loss without this. */
  queueDropped: number | null;
  listener: string;
  disconnectedAt: string;
}

export function clientSession(client: ClientConnection): MqttClientSession {
  return {
    connected: client.state === "connected",
    durable: attr(client, AttrDurable) === "true",
    cleanStart: attr(client, AttrCleanStart) === "true",
    sessionExpirySec: count(client, AttrSessionExpiry),
    subscriptions: count(client, AttrSubscriptions),
    inflight: count(client, AttrInflight),
    queued: count(client, AttrQueued),
    queueDropped: count(client, AttrQueueDropped),
    listener: attr(client, AttrListener),
    disconnectedAt: attr(client, AttrDisconnectedAt),
  };
}

/**
 * A session holding messages for a client that is not connected.
 *
 * The one row on the clients page worth finding: it is invisible from the
 * device's side, costs the broker memory, and ends only when the session
 * expires or somebody kicks it.
 */
export function isOrphanedSession(client: ClientConnection): boolean {
  const session = clientSession(client);
  return !session.connected && session.durable;
}
