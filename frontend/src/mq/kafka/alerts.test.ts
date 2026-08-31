import { describe, expect, it } from "vitest";
import type { Destination, Node, Subscription } from "@/api/models";
import { DEFAULT_ALERT_RULES } from "@/lib/alertRules";
import { NO_FACTS, type AlertFacts } from "@/lib/alertDerive";
import { deriveKafkaAlerts } from "./alerts";

const thresholds = { lag: 1000, disk: 80 };

const topic = (name: string, attributes: Record<string, string>): Destination =>
  ({
    id: 1,
    ref: { namespace: "", name },
    partitions: 3,
    subscribers: -1,
    depth: 0,
    rateIn: -1,
    rateOut: -1,
    lastUpdated: "",
    attributes,
  }) as unknown as Destination;

const group = (name: string, backlog: number, attributes: Record<string, string>): Subscription =>
  ({
    id: 1,
    ref: { namespace: "", name },
    status: "online",
    members: 0,
    destinations: 1,
    backlog,
    rateOut: -1,
    lastUpdated: "",
    attributes,
  }) as unknown as Subscription;

const facts = (over: Partial<AlertFacts>): AlertFacts => ({ ...NO_FACTS, ...over });
const derive = (over: Partial<AlertFacts>) =>
  deriveKafkaAlerts(facts(over), DEFAULT_ALERT_RULES, thresholds);

/*
 * The three degrees of partition trouble are separate rules because they are
 * separate situations: under-replicated still works, offline has lost a
 * replica, and leaderless is neither readable nor writable.
 */
describe("partition health", () => {
  it("warns about an under-replicated topic", () => {
    const alerts = derive({
      destinations: [topic("orders", { underReplicatedPartitions: "2" })],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ruleKey: "partitionUnderReplicated", severity: "warn" });
    expect(alerts[0]!.params).toMatchObject({ topic: "orders", count: 2 });
  });

  it("treats an offline replica as an outage", () => {
    const alerts = derive({ destinations: [topic("orders", { offlinePartitions: "1" })] });
    expect(alerts[0]).toMatchObject({ ruleKey: "partitionOffline", severity: "crit" });
  });

  it("treats a leaderless partition as an outage", () => {
    const alerts = derive({ destinations: [topic("orders", { leaderlessPartitions: "1" })] });
    expect(alerts[0]).toMatchObject({ ruleKey: "partitionLeaderless", severity: "crit" });
  });

  /*
   * A leaderless partition is also offline and also under-replicated. Raising
   * all three for one partition would bury the one that matters, so only the
   * worst is reported.
   */
  it("reports only the worst when one partition is all three", () => {
    const alerts = derive({
      destinations: [
        topic("orders", {
          leaderlessPartitions: "1",
          offlinePartitions: "1",
          underReplicatedPartitions: "1",
        }),
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleKey).toBe("partitionLeaderless");
  });

  it("says nothing about a healthy topic", () => {
    expect(
      derive({
        destinations: [
          topic("orders", {
            underReplicatedPartitions: "0",
            offlinePartitions: "0",
            leaderlessPartitions: "0",
          }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("consumer groups", () => {
  /*
   * A group with a backlog and nothing connected is the one alert that catches
   * a consumer stopping quietly - the lag rule alone would call it a slow
   * consumer rather than an absent one.
   */
  it("reports an empty group that still owes work", () => {
    const alerts = derive({
      consumerGroups: [group("settle", 50, { state: "Empty", hasMembers: "false" })],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ruleKey: "groupOffline", severity: "crit" });
  });

  it("says nothing about an empty group with nothing left to do", () => {
    expect(
      derive({ consumerGroups: [group("settle", 0, { state: "Empty", hasMembers: "false" })] }),
    ).toEqual([]);
  });

  it("warns when a running group falls behind the threshold", () => {
    const alerts = derive({
      consumerGroups: [group("settle", 1500, { state: "Stable", hasMembers: "true" })],
    });
    expect(alerts[0]).toMatchObject({ ruleKey: "groupLag", severity: "warn" });
  });

  it("escalates a lag far past the threshold", () => {
    const alerts = derive({
      consumerGroups: [group("settle", 6000, { state: "Stable", hasMembers: "true" })],
    });
    expect(alerts[0]!.severity).toBe("crit");
  });

  /*
   * A lag nobody could measure is not a lag of zero, and comparing it against
   * a threshold as though it were would raise an alert about nothing.
   */
  it("says nothing about a lag it could not measure", () => {
    expect(
      derive({ consumerGroups: [group("settle", -1, { state: "Stable", hasMembers: "true" })] }),
    ).toEqual([]);
  });
});

describe("brokers", () => {
  it("reports a broker the driver marked offline", () => {
    const node = {
      id: 1,
      name: "broker-1",
      address: "10.0.0.1:9092",
      cluster: "",
      version: "",
      status: "offline",
      rateIn: -1,
      rateOut: -1,
      diskUsage: -1,
      lastSeen: "",
      attributes: { nodeId: "1", controller: "true" },
    } as unknown as Node;

    const alerts = derive({ nodes: [node] });
    expect(alerts[0]).toMatchObject({ ruleKey: "brokerOffline", severity: "crit" });
    expect(alerts[0]!.params).toMatchObject({ broker: "broker-1", role: "controller" });
  });
});
