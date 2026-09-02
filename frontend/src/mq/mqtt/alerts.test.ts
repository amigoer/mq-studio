import { describe, expect, it } from "vitest";
import type { ClientConnection } from "@bindings/model/models";
import type { AlertFacts, AlertThresholds } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import { deriveMqttAlerts } from "./alerts";

const allRules = new Proxy({} as AlertRulePrefs, { get: () => true });
const thresholds: AlertThresholds = { lag: 10, disk: 80 };

function client(over: Partial<ClientConnection> = {}): ClientConnection {
  return {
    name: "gateway-a19f",
    clientName: "gateway-a19f",
    namespace: "",
    user: "",
    node: "emqx@127.0.0.1",
    peerHost: "10.0.0.9",
    peerPort: 50240,
    protocol: "MQTT 5.0",
    state: "connected",
    channels: 0,
    tls: false,
    cipher: "",
    heartbeatSec: 60,
    recvBytes: 0,
    sendBytes: 0,
    recvByteRate: 0,
    sendByteRate: 0,
    connectedAtMs: 0,
    blockedBy: "",
    attributes: { durable: "false", queued: "0", queueDropped: "0" },
    ...over,
  } as ClientConnection;
}

function facts(connections: ClientConnection[]): AlertFacts {
  return { nodes: [], consumerGroups: [], destinations: [], connections };
}

/*
 * MQTT used to fall through to RocketMQ's rules, which read a broker ordinal,
 * a commit log's disk percentage and a dead-letter topic. It reports none of
 * the three, so every rule read zero and the alerts page could not fire.
 */
describe("the MQTT alert rules", () => {
  it("says nothing about a healthy broker", () => {
    expect(deriveMqttAlerts(facts([client()]), allRules, thresholds)).toEqual([]);
  });

  /*
   * The MQTT shape of "a queue nothing is consuming": the broker is holding
   * messages for a client that is not there. Invisible from the device's side,
   * bounded by the session expiry rather than by a consumer arriving.
   */
  it("raises a session queueing for a client that is gone", () => {
    const alerts = deriveMqttAlerts(
      facts([
        client({
          state: "disconnected",
          attributes: { durable: "true", queued: "42", queueDropped: "0" },
        }),
      ]),
      allRules,
      thresholds,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      ruleKey: "queueNoConsumer",
      severity: "crit",
      params: { queue: "gateway-a19f", lag: 42 },
    });
  });

  // A connected client with a backlog is a warning, not the case above: there
  // is somebody there, and they are behind.
  it("raises a backlog on a client that is still connected", () => {
    const alerts = deriveMqttAlerts(
      facts([client({ attributes: { durable: "false", queued: "99", queueDropped: "0" } })]),
      allRules,
      thresholds,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ruleKey: "queueBacklog", severity: "warn" });
  });

  // Any drop at all: the broker accepted a message and then threw it away, and
  // nothing else in the app would ever show it.
  it("raises a dropped queue with no threshold at all", () => {
    const alerts = deriveMqttAlerts(
      facts([client({ attributes: { durable: "false", queued: "0", queueDropped: "1" } })]),
      allRules,
      thresholds,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ruleKey: "queueBacklog", severity: "crit" });
  });

  it("stays quiet under the threshold", () => {
    const alerts = deriveMqttAlerts(
      facts([
        client({
          state: "disconnected",
          attributes: { durable: "true", queued: "3", queueDropped: "0" },
        }),
      ]),
      allRules,
      thresholds,
    );
    expect(alerts).toEqual([]);
  });

  it("honours a rule the operator switched off", () => {
    const off = { ...allRules, queueNoConsumer: false, queueBacklog: false } as AlertRulePrefs;
    const alerts = deriveMqttAlerts(
      facts([
        client({
          state: "disconnected",
          attributes: { durable: "true", queued: "42", queueDropped: "5" },
        }),
      ]),
      off,
      thresholds,
    );
    expect(alerts).toEqual([]);
  });
});
