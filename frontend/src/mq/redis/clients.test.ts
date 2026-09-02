import { describe, expect, it } from "vitest";
import type { ClientConnection } from "@bindings/model/models";
import {
  ageSeconds,
  clientId,
  clientName,
  database,
  idleSeconds,
  isThisApp,
  lastCommand,
  library,
  peer,
  protocol,
  subscriptions,
  user,
} from "./clients";

function client(
  attributes: Record<string, string>,
  overrides: Partial<ClientConnection> = {},
): ClientConnection {
  return {
    name: "42",
    clientName: "reporting-service",
    namespace: "0",
    user: "mqstudio",
    node: "10.2.0.8:6379",
    peerHost: "10.2.0.44",
    peerPort: 51234,
    protocol: "RESP3",
    state: "N",
    channels: 0,
    tls: false,
    cipher: "",
    heartbeatSec: 0,
    recvBytes: 91204,
    sendBytes: 884210,
    recvByteRate: 0,
    sendByteRate: 0,
    connectedAtMs: 0,
    blockedBy: "",
    attributes,
    ...overrides,
  } as unknown as ClientConnection;
}

describe("the Redis client readers", () => {
  /*
   * The id is what a close request names, and it is deliberately not the
   * address: Redis kills by either, and an address is reused the moment its
   * port is - so a client that reconnected between the page being drawn and
   * the button being pressed would be killed in place of the one meant.
   */
  it("identifies a connection by its id, not its address", () => {
    expect(clientId(client({}))).toBe("42");
  });

  it("reads the peer, user, database and protocol", () => {
    const connection = client({});
    expect(peer(connection)).toBe("10.2.0.44:51234");
    expect(user(connection)).toBe("mqstudio");
    expect(database(connection)).toBe("0");
    expect(protocol(connection)).toBe("RESP3");
  });

  it("reads the fields only Redis has out of the attribute map", () => {
    const connection = client({
      lastCommand: "xrange",
      idleSeconds: "3",
      ageSeconds: "8402",
      libraryName: "go-redis",
      subscriptions: "3",
    });
    expect(lastCommand(connection)).toBe("xrange");
    expect(idleSeconds(connection)).toBe(3);
    expect(ageSeconds(connection)).toBe(8402);
    expect(library(connection)).toBe("go-redis");
    expect(subscriptions(connection)).toBe(3);
  });

  /*
   * Most libraries never call CLIENT SETNAME, so an unnamed client is the
   * common case rather than an error - and the peer address stays the
   * identifier a reader recognises.
   */
  it("reads an unnamed client as unnamed rather than as empty text", () => {
    expect(clientName(client({}, { clientName: "" }))).toBeNull();
    expect(clientName(client({}))).toBe("reporting-service");
  });

  it("reads a field an older server did not send as absent, not zero", () => {
    const old = client({});
    expect(lastCommand(old)).toBeNull();
    expect(idleSeconds(old)).toBeNull();
    expect(library(old)).toBeNull();
    expect(subscriptions(old)).toBeNull();
  });

  it("renders a peer with no port as just the host", () => {
    expect(peer(client({}, { peerPort: 0 }))).toBe("10.2.0.44");
  });

  /*
   * Killing the connection the console is using disconnects the console, which
   * is a surprising way to find out what a button does - so the page has to be
   * able to tell which row that is.
   */
  it("recognises this app's own connection", () => {
    expect(isThisApp(client({}, { clientName: "mq-studio.prod-redis" }))).toBe(true);
    expect(isThisApp(client({}, { clientName: "mq-studio" }))).toBe(true);
    expect(isThisApp(client({}))).toBe(false);
    expect(isThisApp(client({}, { clientName: "" }))).toBe(false);
  });
});
