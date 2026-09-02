import { describe, expect, it } from "vitest";
import type { Node, Subscription } from "@/api/models";
import { NO_FACTS, type AlertFacts, type DerivedAlert } from "@/lib/alertDerive";
import { ALERT_RULE_KEYS, type AlertRulePrefs } from "@/lib/alertRules";
import { deriveRedisAlerts } from "./alerts";

const allOn: AlertRulePrefs = Object.fromEntries(
  ALERT_RULE_KEYS.map((key) => [key, true]),
) as AlertRulePrefs;

const thresholds = { lag: 100, disk: 80 };

function node(attributes: Record<string, string>, overrides: Partial<Node> = {}): Node {
  return {
    id: 1,
    name: "10.2.0.8:6379",
    address: "10.2.0.8:6379",
    cluster: "",
    version: "8.10.1",
    status: "online",
    rateIn: -1,
    rateOut: -1,
    diskUsage: -1,
    lastSeen: "",
    attributes,
    ...overrides,
  } as unknown as Node;
}

function group(attributes: Record<string, string>, overrides: Partial<Subscription> = {}) {
  return {
    id: 1,
    ref: { namespace: "orders:events", name: "settle-group" },
    status: "online",
    members: 2,
    destinations: 1,
    backlog: 10,
    rateOut: -1,
    lastUpdated: "",
    attributes,
    ...overrides,
  } as unknown as Subscription;
}

const facts = (over: Partial<AlertFacts>): AlertFacts => ({ ...NO_FACTS, ...over });

/**
 * The one alert a case expects.
 *
 * Asserting the length first means an empty result fails as "raised nothing"
 * rather than as an index into undefined, which says nothing about the rule.
 */
function only(derived: readonly DerivedAlert[]): DerivedAlert {
  expect(derived).toHaveLength(1);
  const first = derived[0];
  if (first == null) throw new Error("no alert was raised");
  return first;
}

describe("the Redis alert rules", () => {
  it("raises nothing on a healthy server", () => {
    const healthy = node({ usedMemory: "100", maxMemory: "1000", rdbLastBgsaveStatus: "ok" });
    const derived = deriveRedisAlerts(
      facts({ nodes: [healthy], consumerGroups: [group({ pending: "4" })] }),
      allOn,
      thresholds,
    );
    expect(derived).toEqual([]);
  });

  /*
   * The server is answering every request and its data is not being written
   * down. No other figure shows it, and a restart turns it into data loss.
   */
  it("raises a failed background save as critical", () => {
    const derived = deriveRedisAlerts(
      facts({ nodes: [node({ rdbLastBgsaveStatus: "err" })] }),
      allOn,
      thresholds,
    );
    const alert = only(derived);
    expect(alert.ruleKey).toBe("resourceAlarm");
    expect(alert.severity).toBe("crit");
  });

  /*
   * Never having run a save is not a failure, and must not fire: a server that
   * has simply never been asked would otherwise raise a critical alert from
   * the moment it started.
   */
  it("does not raise on a server that has never saved", () => {
    expect(deriveRedisAlerts(facts({ nodes: [node({})] }), allOn, thresholds)).toEqual([]);
  });

  it("raises memory against the server's own cap", () => {
    const derived = deriveRedisAlerts(
      facts({ nodes: [node({ usedMemory: "850", maxMemory: "1000" })] }),
      allOn,
      thresholds,
    );
    const alert = only(derived);
    expect(alert.ruleKey).toBe("memoryUsage");
    expect(alert.severity).toBe("warn");
    expect(alert.params.usage).toBe(85);
  });

  it("escalates memory to critical near the cap", () => {
    const derived = deriveRedisAlerts(
      facts({ nodes: [node({ usedMemory: "980", maxMemory: "1000" })] }),
      allOn,
      thresholds,
    );
    expect(only(derived).severity).toBe("crit");
  });

  /*
   * A server with no maxmemory has nothing to be a percentage of. Treating
   * "no cap" as 0% would silence the rule on exactly the servers where running
   * out of memory is worst.
   */
  it("does not raise memory on a server with no cap", () => {
    const derived = deriveRedisAlerts(
      facts({ nodes: [node({ usedMemory: "999999999", maxMemory: "0" })] }),
      allOn,
      thresholds,
    );
    expect(derived).toEqual([]);
  });

  /*
   * The rule Redis exists to have. The entries are not lost and not delivered:
   * they are owed to a consumer that is gone, and no amount of waiting changes
   * that.
   */
  it("raises a group holding work with nothing attached", () => {
    const stalled = group({ pending: "12" }, { members: 0, backlog: 0 });
    const derived = deriveRedisAlerts(facts({ consumerGroups: [stalled] }), allOn, thresholds);
    const alert = only(derived);
    expect(alert.ruleKey).toBe("groupOffline");
    expect(alert.params.pending).toBe(12);
    // Both halves of the identity, because a group name alone is not unique.
    expect(alert.params.group).toBe("orders:events / settle-group");
  });

  it("does not raise on a group with nothing attached and nothing owed", () => {
    const idle = group({ pending: "0" }, { members: 0, backlog: 0 });
    expect(deriveRedisAlerts(facts({ consumerGroups: [idle] }), allOn, thresholds)).toEqual([]);
  });

  it("raises a group past the lag threshold", () => {
    const behind = group({ pending: "0" }, { backlog: 500 });
    const derived = deriveRedisAlerts(facts({ consumerGroups: [behind] }), allOn, thresholds);
    const alert = only(derived);
    expect(alert.ruleKey).toBe("groupLag");
    expect(alert.params.lag).toBe(500);
  });

  /*
   * Once entries a group had not read are deleted, Redis stops being able to
   * count the lag and says so with nil. Firing on that would be firing on a
   * number nobody has.
   */
  it("does not raise a lag alert on a lag nobody could count", () => {
    const unknown = group({ pending: "0" }, { backlog: -1 });
    expect(deriveRedisAlerts(facts({ consumerGroups: [unknown] }), allOn, thresholds)).toEqual([]);
  });

  it("honours a rule that was switched off", () => {
    const off = { ...allOn, memoryUsage: false };
    const derived = deriveRedisAlerts(
      facts({ nodes: [node({ usedMemory: "980", maxMemory: "1000" })] }),
      off,
      thresholds,
    );
    expect(derived).toEqual([]);
  });

  // A threshold of zero disables the rule, which is how the settings page
  // expresses "never raise this" without a second switch.
  it("treats a zero threshold as off", () => {
    const derived = deriveRedisAlerts(
      facts({
        nodes: [node({ usedMemory: "980", maxMemory: "1000" })],
        consumerGroups: [group({ pending: "0" }, { backlog: 5000 })],
      }),
      allOn,
      { lag: 0, disk: 0 },
    );
    expect(derived).toEqual([]);
  });
});
