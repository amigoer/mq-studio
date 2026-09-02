/**
 * Redis's view of a canonical client connection.
 *
 * The keys are a contract with internal/driver/redisstream/connections.go.
 *
 * Several canonical fields are left alone rather than filled in: Redis reports
 * no TLS state, no heartbeat and no channels per connection, and a false or a
 * zero in those would be an answer the server never gave. The board draws none
 * of them.
 */
import type { ClientConnection } from "@bindings/model/models";

const AttrLastCommand = "lastCommand";
const AttrIdleSeconds = "idleSeconds";
const AttrAgeSeconds = "ageSeconds";
const AttrFlags = "flags";
const AttrLibraryName = "libraryName";
const AttrSubscribed = "subscriptions";
const AttrTotalCommand = "totalCommands";

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

/**
 * The connection id, which is what a close request names.
 *
 * Not the address: Redis kills by either, and an address is reused the moment
 * its port is - so a client that reconnected between the page being drawn and
 * the button being pressed would be killed in place of the one meant.
 */
export const clientId = (connection: ClientConnection): string => connection.name;

export const peer = (connection: ClientConnection): string =>
  connection.peerPort === 0 ? connection.peerHost : `${connection.peerHost}:${connection.peerPort}`;

/** What the application called itself, or null - most libraries say nothing. */
export const clientName = (connection: ClientConnection): string | null =>
  connection.clientName === "" ? null : connection.clientName;

export const user = (connection: ClientConnection): string | null =>
  connection.user === "" ? null : connection.user;

/** The database this connection selected. */
export const database = (connection: ClientConnection): string | null =>
  connection.namespace === "" ? null : connection.namespace;

/** RESP2 or RESP3, which changes what replies this client gets. */
export const protocol = (connection: ClientConnection): string | null =>
  connection.protocol === "" ? null : connection.protocol;

export const lastCommand = (connection: ClientConnection): string | null =>
  attr(connection, AttrLastCommand);
export const library = (connection: ClientConnection): string | null =>
  attr(connection, AttrLibraryName);
export const flags = (connection: ClientConnection): string | null => attr(connection, AttrFlags);
export const idleSeconds = (connection: ClientConnection): number | null =>
  number(connection, AttrIdleSeconds);
export const ageSeconds = (connection: ClientConnection): number | null =>
  number(connection, AttrAgeSeconds);
export const totalCommands = (connection: ClientConnection): number | null =>
  number(connection, AttrTotalCommand);

/** How many channels and patterns this connection subscribes to, if any. */
export const subscriptions = (connection: ClientConnection): number | null =>
  number(connection, AttrSubscribed);

export const bytesIn = (connection: ClientConnection): number => connection.recvBytes;
export const bytesOut = (connection: ClientConnection): number => connection.sendBytes;

/**
 * Whether this connection is the app's own.
 *
 * It matters on a page with a close button: killing the connection the console
 * is using disconnects the console, which is a surprising way to find out what
 * a button does.
 */
export function isThisApp(connection: ClientConnection, appPrefix = "mq-studio"): boolean {
  return (connection.clientName ?? "").startsWith(appPrefix);
}
