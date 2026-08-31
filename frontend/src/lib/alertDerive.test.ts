import { describe, expect, it } from "vitest";
import { deriveAlerts, NO_FACTS, type AlertFacts } from "./alertDerive";
import { DEFAULT_ALERT_RULES, rulesFor, type AlertRulePrefs } from "./alertRules";
import { MQKind, NodeStatus, SubscriptionStatus } from "@bindings/model/models";
import type { Destination, Node, Subscription } from "@/api/models";

/**
 * The rules, per family.
 *
 * They used to be one set reading RocketMQ's attribute keys against every
 * connection, which meant a RabbitMQ broker was measured for a broker ordinal,
 * a consumer group's backlog and a commit log's disk usage - three figures it
 * never reports - and so raised nothing whatever was wrong with it.
 *
 * Half of this file is the RocketMQ half, unchanged, because the split is only
 * safe if it did not move.
 */

const thresholds = { lag: 1000, disk: 75 };

const rules: AlertRulePrefs = { ...DEFAULT_ALERT_RULES };

function facts(over: Partial<AlertFacts>): AlertFacts {
  return { ...NO_FACTS, ...over };
}

function node(attributes: Record<string, string>, over: Partial<Node> = {}): Node {
  return {
    name: "rabbit@one",
    address: "rabbit@one",
    version: "4.1.2",
    status: "online",
    rateIn: -1,
    rateOut: -1,
    diskUsage: -1,
    lastSeen: "",
    attributes,
    ...over,
  } as Node;
}

function queue(
  name: string,
  ready: number,
  unacked: number,
  consumers: number,
  namespace = "/",
): Destination {
  return {
    ref: { namespace, name },
    partitions: -1,
    subscribers: consumers,
    depth: ready + unacked,
    rateIn: 0,
    rateOut: 0,
    attributes: {
      messagesReady: String(ready),
      messagesUnacknowledged: String(unacked),
      queueType: "classic",
    },
  } as unknown as Destination;
}

function group(over: Partial<Subscription>): Subscription {
  return {
    ref: { namespace: "", name: "CID_ORDER" },
    status: "online",
    members: 3,
    backlog: 0,
    lastUpdated: "",
    attributes: {},
    ...over,
  } as unknown as Subscription;
}

describe("the RocketMQ rules", () => {
  const derive = (over: Partial<AlertFacts>) =>
    deriveAlerts(MQKind.KindRocketMQ, facts(over), rules, thresholds);

  it("still fires on an offline broker with its ordinal in the name", () => {
    const alerts = derive({
      nodes: [
        node({ brokerId: "1" }, { name: "broker-b", address: "10.0.0.2:10911", status: NodeStatus.NodeOffline }),
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ruleKey).toBe("brokerOffline");
    expect(alerts[0]?.params.broker).toBe("broker-b-1");
  });

  it("still fires on a lagging group, and on a stalled one instead", () => {
    const lagging = derive({ consumerGroups: [group({ backlog: 5000 })] });
    expect(lagging.map((alert) => alert.ruleKey)).toEqual(["groupLag"]);

    // A group with backlog and nobody reading it is the worse of the two and
    // must not raise both rows.
    const stalled = derive({
      consumerGroups: [group({ backlog: 5000, status: SubscriptionStatus.SubscriptionOffline, members: 0 })],
    });
    expect(stalled.map((alert) => alert.ruleKey)).toEqual(["groupOffline"]);
  });

  it("still reads commit log disk usage, and escalates well past the threshold", () => {
    expect(derive({ nodes: [node({}, { diskUsage: 80 })] })[0]?.severity).toBe("warn");
    expect(derive({ nodes: [node({}, { diskUsage: 95 })] })[0]?.severity).toBe("crit");
    expect(derive({ nodes: [node({}, { diskUsage: 50 })] })).toHaveLength(0);
  });

  /*
   * RabbitMQ's facts must not reach RocketMQ's rules. A queue's depth and a
   * connection's state are the new lists, and the old rules never read them.
   */
  it("ignores the lists its rules do not read", () => {
    expect(
      derive({
        destinations: [queue("orders.q", 90_000, 0, 0)],
        connections: [{ name: "c1", state: "blocked", peerHost: "10.0.0.9" } as never],
      }),
    ).toHaveLength(0);
  });
});

describe("the RabbitMQ rules", () => {
  const derive = (over: Partial<AlertFacts>) =>
    deriveAlerts(MQKind.KindRabbitMQ, facts(over), rules, thresholds);

  const healthy = {
    memoryUsed: "100",
    memoryLimit: "1000",
    memoryAlarm: "false",
    diskFree: "10000",
    diskFreeLimit: "1000",
    diskFreeAlarm: "false",
    partitions: "",
  };

  /*
   * The bug this replaced: RocketMQ's rules read attributes RabbitMQ does not
   * set, so a broker sitting on a memory alarm with an abandoned queue raised
   * nothing at all.
   */
  it("fires on a broker the old rules were silent about", () => {
    const before = deriveAlerts(
      MQKind.KindRocketMQ,
      facts({
        nodes: [node({ ...healthy, memoryAlarm: "true" })],
        destinations: [queue("orders.q", 90_000, 0, 0)],
      }),
      rules,
      thresholds,
    );
    expect(before).toHaveLength(0);

    const after = derive({
      nodes: [node({ ...healthy, memoryAlarm: "true" })],
      destinations: [queue("orders.q", 90_000, 0, 0)],
    });
    expect(after.map((alert) => alert.ruleKey).sort()).toEqual([
      "queueNoConsumer",
      "resourceAlarm",
    ]);
  });

  /*
   * An alarm is not a warning about the future: while it is up the node has
   * already stopped accepting publishes.
   */
  it("reports which resource raised the alarm", () => {
    expect(derive({ nodes: [node({ ...healthy, memoryAlarm: "true" })] })[0]?.params.resource).toBe(
      "memory",
    );
    expect(
      derive({ nodes: [node({ ...healthy, diskFreeAlarm: "true" })] })[0]?.params.resource,
    ).toBe("disk");
    expect(
      derive({
        nodes: [node({ ...healthy, memoryAlarm: "true", diskFreeAlarm: "true" })],
      })[0]?.params.resource,
    ).toBe("both");
  });

  // The alarm and the watermark are the same fact, and the alarm already says
  // it at the severity it deserves.
  it("does not repeat an alarm as a watermark warning", () => {
    const alerts = derive({
      nodes: [node({ ...healthy, diskFree: "1000", diskFreeAlarm: "true" })],
    });
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["resourceAlarm"]);
  });

  it("warns as free disk approaches the floor the broker alarms at", () => {
    // Free disk at 1.25x the limit: 80% of the way to the alarm.
    const near = derive({ nodes: [node({ ...healthy, diskFree: "1250" })] });
    expect(near.map((alert) => alert.ruleKey)).toEqual(["diskUsage"]);
    expect(near[0]?.params.usage).toBe(80);

    expect(derive({ nodes: [node({ ...healthy, diskFree: "10000" })] })).toHaveLength(0);
  });

  it("warns as memory approaches its high watermark", () => {
    const near = derive({ nodes: [node({ ...healthy, memoryUsed: "800" })] });
    expect(near.map((alert) => alert.ruleKey)).toEqual(["memoryUsage"]);
    expect(near[0]?.params.usage).toBe(80);
  });

  /*
   * A partition is the cluster running as two halves that each believe they
   * are whole, which is the worst thing a node can be saying.
   */
  it("fires on a network partition and names who was lost", () => {
    const alerts = derive({
      nodes: [node({ ...healthy, partitions: "rabbit@two,rabbit@three" })],
    });
    expect(alerts[0]?.ruleKey).toBe("nodePartition");
    expect(alerts[0]?.severity).toBe("crit");
    expect(alerts[0]?.params.peers).toBe("rabbit@two, rabbit@three");
    expect(alerts[0]?.params.count).toBe(2);
  });

  /*
   * A node that is not answering reports the last figures it managed to send,
   * and alarming on those would be alarming on history.
   */
  it("reports an offline node once, not once per stale figure", () => {
    const alerts = derive({
      nodes: [
        node(
          { ...healthy, memoryAlarm: "true", partitions: "rabbit@two" },
          { status: NodeStatus.NodeOffline },
        ),
      ],
    });
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["brokerOffline"]);
  });

  /*
   * Nobody reading is the worse of the two and excludes the plain backlog
   * alert: one abandoned queue must not raise two rows.
   */
  it("tells an abandoned queue apart from a slow one", () => {
    const abandoned = derive({ destinations: [queue("orders.q", 5000, 0, 0)] });
    expect(abandoned.map((alert) => alert.ruleKey)).toEqual(["queueNoConsumer"]);

    const slow = derive({ destinations: [queue("orders.q", 5000, 20, 3)] });
    expect(slow.map((alert) => alert.ruleKey)).toEqual(["queueBacklog"]);
  });

  /*
   * Unacknowledged messages are held by a consumer that exists, so a queue
   * whose whole depth is unacked has someone reading it however slowly.
   */
  it("does not call a queue abandoned when its depth is all unacknowledged", () => {
    const alerts = derive({ destinations: [queue("orders.q", 0, 5000, 1)] });
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["queueBacklog"]);
  });

  // A queue name is only unique within its virtual host.
  it("names a queue by its virtual host outside the default one", () => {
    const alerts = derive({ destinations: [queue("orders.q", 5000, 0, 0, "prod")] });
    expect(alerts[0]?.params.queue).toBe("prod/orders.q");

    const root = derive({ destinations: [queue("orders.q", 5000, 0, 0)] });
    expect(root[0]?.params.queue).toBe("orders.q");
  });

  /*
   * Throttling is a state of a connection rather than of the broker, so it is
   * counted: one row saying forty connections are throttled is an alert, forty
   * rows is a log.
   */
  it("counts throttled connections into one row", () => {
    const alerts = derive({
      connections: [
        { name: "c1", state: "running", peerHost: "10.0.0.1" },
        { name: "c2", state: "flow", peerHost: "10.0.0.2" },
        { name: "c3", state: "blocked", peerHost: "10.0.0.3" },
        { name: "c4", state: "blocking", peerHost: "10.0.0.4" },
      ] as never,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ruleKey).toBe("flowControl");
    expect(alerts[0]?.params.count).toBe(3);
    expect(alerts[0]?.params.peer).toBe("10.0.0.2");
  });

  /*
   * The exact attribute map a RabbitMQ 4 node sends while a memory alarm is
   * actually up, copied off the e2e broker with the watermark forced down.
   *
   * The hand-built fixtures above prove the rules work; this proves they are
   * reading the keys the driver really writes. An attribute key that drifts
   * makes every alarm rule silently read false, which is the failure this
   * whole file exists to prevent - and nothing else in the suite would notice.
   */
  it("fires on the attribute map a real broker sends during an alarm", () => {
    const observed = {
      diskFree: "12539916288",
      diskFreeAlarm: "false",
      diskFreeLimit: "50000000",
      erlangProcessLimit: "1048576",
      erlangProcesses: "449",
      fileDescriptorLimit: "1048576",
      fileDescriptorsUsed: "41",
      memoryAlarm: "true",
      memoryLimit: "50000000",
      memoryUsed: "162992128",
      nodeType: "disc",
      partitions: "",
      runQueue: "1",
      schedulers: "8",
      uptime: "2570712",
    };
    // The broker calls a node with an alarm up "warning", not offline: it is
    // answering perfectly well, it has just stopped accepting publishes.
    const alerts = derive({
      nodes: [node(observed, { name: "rabbit@f1503fbeaee8", status: NodeStatus.NodeWarning })],
    });

    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["resourceAlarm"]);
    expect(alerts[0]?.params.resource).toBe("memory");
    expect(alerts[0]?.params.broker).toBe("rabbit@f1503fbeaee8");
  });

  it("says nothing about a broker with nothing wrong with it", () => {
    expect(
      derive({
        nodes: [node(healthy)],
        destinations: [queue("orders.q", 12, 0, 2)],
        connections: [{ name: "c1", state: "running", peerHost: "10.0.0.1" } as never],
      }),
    ).toHaveLength(0);
  });

  it("respects a rule that has been switched off", () => {
    const off: AlertRulePrefs = { ...rules, resourceAlarm: false };
    expect(
      deriveAlerts(
        MQKind.KindRabbitMQ,
        facts({ nodes: [node({ ...healthy, memoryAlarm: "true" })] }),
        off,
        thresholds,
      ),
    ).toHaveLength(0);
  });

  // Zero disables the rules that measure against it, which is what the
  // settings page promises.
  it("stops measuring when a threshold is zeroed", () => {
    const quiet = deriveAlerts(
      MQKind.KindRabbitMQ,
      facts({
        nodes: [node({ ...healthy, diskFree: "1000", memoryUsed: "900" })],
        destinations: [queue("orders.q", 90_000, 0, 0)],
      }),
      rules,
      { lag: 0, disk: 0 },
    );
    expect(quiet).toHaveLength(0);
  });

  it("orders the worst first", () => {
    const alerts = derive({
      nodes: [node({ ...healthy, memoryUsed: "800", partitions: "rabbit@two" })],
    });
    expect(alerts.map((alert) => alert.severity)).toEqual(["crit", "warn"]);
  });
});

describe("which rules a family offers", () => {
  /*
   * The switches are stored for every rule, because a window can hold two
   * families at once. What the family decides is which are worth showing.
   */
  it("offers RabbitMQ only what RabbitMQ can raise", () => {
    const keys = rulesFor(MQKind.KindRabbitMQ);
    expect(keys).toContain("resourceAlarm");
    expect(keys).toContain("queueNoConsumer");
    expect(keys).not.toContain("groupLag");
    expect(keys).not.toContain("dlqGrowth");
  });

  it("leaves RocketMQ's list as it was", () => {
    expect(rulesFor(MQKind.KindRocketMQ)).toEqual([
      "brokerOffline",
      "groupOffline",
      "groupLag",
      "diskUsage",
      "dlqGrowth",
    ]);
  });

  // Every rule has a default, or a toggle read from storage would be
  // undefined and the rule would silently never fire.
  it("has a default for every rule a family offers", () => {
    for (const kind of [MQKind.KindRabbitMQ, MQKind.KindRocketMQ]) {
      for (const key of rulesFor(kind)) {
        expect(DEFAULT_ALERT_RULES[key]).toBe(true);
      }
    }
  });
});
