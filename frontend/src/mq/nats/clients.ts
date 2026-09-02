/**
 * NATS's view of a canonical client connection.
 *
 * The keys are a contract with internal/driver/nats/clients.go.
 *
 * Two canonical fields are read differently here and both are worth knowing.
 * `name` is the server plus the client id joined by a slash, because neither
 * half addresses a connection on its own - a client id counts within one
 * server, so two servers in a cluster each have a client 7. And `channels` is
 * UnknownMetric rather than zero: a NATS connection has no second layer inside
 * it at all, so there is nothing to count.
 */
import type { ClientConnection } from "@bindings/model/models";

const AttrCID = "cid";
const AttrLanguage = "language";
const AttrLibVersion = "libVersion";
const AttrIdleTime = "idle";
const AttrLastActivity = "lastActivity";
const AttrPendingBytes = "pendingBytes";
const AttrInMsgs = "inMsgs";
const AttrOutMsgs = "outMsgs";
const AttrRTT = "rtt";
const AttrSubjectList = "subjectList";
const AttrAccount = "account";
const AttrKind = "kind";
const AttrSource = "readVia";

function attr(connection: ClientConnection, key: string): string | null {
  const value = connection.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(connection: ClientConnection, key: string): number | null {
  const raw = attr(connection, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

/** The key a close request names: the server holding it, and its client id. */
export const connectionKey = (connection: ClientConnection): string => connection.name;

/** Which server holds it. Half of the address, not a label. */
export const serverOf = (connection: ClientConnection): string => connection.node;

export const clientId = (connection: ClientConnection): number | null =>
  number(connection, AttrCID);

/**
 * What the application called itself, or null when it said nothing.
 *
 * Most libraries send nothing, which is why the peer address stays the primary
 * identifier and this is shown beside it rather than instead of it.
 */
export function clientName(connection: ClientConnection): string | null {
  const name = connection.clientName?.trim();
  return name == null || name === "" ? null : name;
}

export const peer = (connection: ClientConnection): string =>
  `${connection.peerHost}:${connection.peerPort}`;

export const account = (connection: ClientConnection): string | null =>
  attr(connection, AttrAccount);
export const user = (connection: ClientConnection): string | null =>
  connection.user === "" ? null : connection.user;

/** The transport it arrived over: any of TCP, TLS, WebSocket or MQTT. */
export const transport = (connection: ClientConnection): string => connection.protocol;
export const isEncrypted = (connection: ClientConnection): boolean => connection.tls;
export const cipher = (connection: ClientConnection): string | null =>
  connection.cipher === "" ? null : connection.cipher;

/**
 * What the connection is subscribed to.
 *
 * The only answer NATS has to "what is this client doing": outside JetStream
 * there is no consumer object to look one up in, so the subject list is the
 * whole of it.
 */
export function subjects(connection: ClientConnection): string[] {
  const raw = attr(connection, AttrSubjectList);
  if (raw == null) return [];
  return raw
    .split(",")
    .map((subject) => subject.trim())
    .filter((subject) => subject !== "");
}

export const inMessages = (connection: ClientConnection): number | null =>
  number(connection, AttrInMsgs);
export const outMessages = (connection: ClientConnection): number | null =>
  number(connection, AttrOutMsgs);

/**
 * Bytes the server is holding to send this client.
 *
 * The figure that says a client is falling behind: it is what has been written
 * for them and not yet accepted, and a server disconnects a client whose
 * pending bytes pass its limit.
 */
export const pendingBytes = (connection: ClientConnection): number | null =>
  number(connection, AttrPendingBytes);

export const idleFor = (connection: ClientConnection): string | null =>
  attr(connection, AttrIdleTime);
export const lastActivity = (connection: ClientConnection): string | null =>
  attr(connection, AttrLastActivity);
export const roundTrip = (connection: ClientConnection): string | null =>
  attr(connection, AttrRTT);

/** Which client library, and its version. Often the fastest way to find one. */
export const language = (connection: ClientConnection): string | null =>
  attr(connection, AttrLanguage);
export const libraryVersion = (connection: ClientConnection): string | null =>
  attr(connection, AttrLibVersion);

/** Whether this is an ordinary client or a route, leaf or gateway link. */
export const kind = (connection: ClientConnection): string | null => attr(connection, AttrKind);

export const receivedBytes = (connection: ClientConnection): number => connection.recvBytes;
export const sentBytes = (connection: ClientConnection): number => connection.sendBytes;
export const connectedAtMs = (connection: ClientConnection): number => connection.connectedAtMs;

/**
 * Which tier this row came from, and therefore what can be done to it.
 *
 * A connection read through the monitoring endpoint cannot be closed: that
 * endpoint is read-only by design, so there is no request to make. Carried per
 * row rather than worked out once for the page, because a connection is
 * addressed on the server holding it and the two tiers can answer for
 * different ones.
 */
export const readVia = (connection: ClientConnection): string | null =>
  attr(connection, AttrSource);

export const canBeClosed = (connection: ClientConnection): boolean =>
  readVia(connection) === "system";
