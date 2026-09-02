import { describe, expect, it } from "vitest";
import { Node, Subscription, SubscriptionRef } from "@bindings/model/models";
import { DEFAULT_ALERT_RULES, rulesFor } from "@/lib/alertRules";
import { MQKind } from "@bindings/model/models";
import { NO_FACTS } from "@/lib/alertDerive";
import { derivePulsarAlerts } from "./alerts";

const thresholds = { lag: 100, disk: 80 };

const subscription = (
  name: string,
  over: { members?: number; backlog?: number; attributes?: Record<string, string> } = {},
): Subscription =>
  new Subscription({
    ref: new SubscriptionRef({ namespace: "persistent://public/default/orders", name }),
    members: over.members ?? 1,
    backlog: over.backlog ?? 0,
    attributes: over.attributes ?? {},
  });

const node = (address: string, attributes: Record<string, string> = {}): Node =>
  new Node({ address, name: address, attributes });

const facts = (over: Partial<typeof NO_FACTS> = {}) => ({ ...NO_FACTS, ...over });

/*
 * A blocked subscription is the alert this family exists to raise.
 *
 * Past its unacknowledged limit the broker stops delivering entirely. The
 * backlog then grows for a reason that is not the consumer's speed, looks
 * identical to a slow consumer from the backlog alone, and is fixed by
 * acknowledging or raising a limit rather than by touching the consumer.
 */
describe("a blocked subscription", () => {
  it("fires as critical", () => {
    const alerts = derivePulsarAlerts(
      facts({
        consumerGroups: [
          subscription("worker", {
            backlog: 5000,
            attributes: {
              pulsarSubscriptionBlocked: "true",
              pulsarSubscriptionUnacked: "50000",
            },
          }),
        ],
      }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ruleKey).toBe("subscriptionBlocked");
    expect(alerts[0]?.severity).toBe("crit");
    expect(alerts[0]?.params["unacked"]).toBe(50000);
  });

  /*
   * And it raises one alert, not two. Its backlog is a consequence of being
   * blocked, so a lag alert beside it would describe the same problem twice
   * and send somebody to look at a consumer that is fine.
   */
  it("does not also raise a lag alert about the same subscription", () => {
    const alerts = derivePulsarAlerts(
      facts({
        consumerGroups: [
          subscription("worker", {
            backlog: 999999,
            attributes: { pulsarSubscriptionBlocked: "true" },
          }),
        ],
      }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["subscriptionBlocked"]);
  });
});

/*
 * An idle subscription is normal on this family and must not fire on its own.
 *
 * A Pulsar subscription is a stored cursor: one created ahead of the consumer
 * that will use it is exactly the point of being able to create one. Alerting
 * on every one of those would make the page noise.
 */
describe("a subscription with nothing attached", () => {
  it("is silent when nothing is waiting for it", () => {
    const alerts = derivePulsarAlerts(
      facts({ consumerGroups: [subscription("fresh", { members: 0, backlog: 0 })] }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(alerts).toHaveLength(0);
  });

  it("fires once something is waiting", () => {
    const alerts = derivePulsarAlerts(
      facts({ consumerGroups: [subscription("stalled", { members: 0, backlog: 42 })] }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["groupOffline"]);
    expect(alerts[0]?.params["lag"]).toBe(42);
  });
});

describe("a subscription that is behind", () => {
  it("fires at the threshold and not below it", () => {
    const under = derivePulsarAlerts(
      facts({ consumerGroups: [subscription("slow", { backlog: 99 })] }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(under).toHaveLength(0);

    const over = derivePulsarAlerts(
      facts({ consumerGroups: [subscription("slow", { backlog: 100 })] }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(over.map((alert) => alert.ruleKey)).toEqual(["groupLag"]);
  });

  // Zero disables the rule, which is what the settings page means by clearing
  // the field.
  it("is silent when the threshold is zero", () => {
    const alerts = derivePulsarAlerts(
      facts({ consumerGroups: [subscription("slow", { backlog: 99999 })] }),
      DEFAULT_ALERT_RULES,
      { lag: 0, disk: 80 },
    );
    expect(alerts).toHaveLength(0);
  });
});

/*
 * Memory rather than disk, and direct memory counts.
 *
 * Pulsar's messages are BookKeeper's, so no broker reports a disk figure at
 * all. Direct memory is where its network buffers live, so exhausting it stops
 * the broker accepting connections rather than merely slowing it - which is
 * why the higher of the two decides.
 */
describe("broker memory", () => {
  it("fires on the higher of heap and direct memory", () => {
    const alerts = derivePulsarAlerts(
      facts({
        nodes: [
          node("broker-1:8080", {
            pulsarMemoryPercent: "40",
            pulsarDirectMemoryPercent: "91",
          }),
        ],
      }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(alerts.map((alert) => alert.ruleKey)).toEqual(["memoryUsage"]);
    expect(alerts[0]?.params["usage"]).toBe(91);
  });

  /*
   * A broker the load manager did not describe has no memory reading at all,
   * and treating that as 0% would make this rule silent for exactly the
   * brokers nobody can see.
   */
  it("is silent for a broker that reported nothing", () => {
    const alerts = derivePulsarAlerts(
      facts({ nodes: [node("broker-2:8080")] }),
      DEFAULT_ALERT_RULES,
      thresholds,
    );
    expect(alerts).toHaveLength(0);
  });
});

/*
 * The rule list is what the settings page offers as switches, so a rule that
 * cannot fire on this family must not be in it.
 *
 * Pulsar's active-broker listing stops listing a broker that has gone rather
 * than reporting it offline, and no broker reports a disk figure - so a switch
 * for either would be a switch for something that can never happen.
 */
describe("the rules this family offers", () => {
  it("does not offer one that cannot fire", () => {
    const offered = rulesFor(MQKind.KindPulsar);
    expect(offered).not.toContain("brokerOffline");
    expect(offered).not.toContain("diskUsage");
    expect(offered).toContain("subscriptionBlocked");
  });

  // Not a fallthrough to RocketMQ's, which read a backlog off a consumer group
  // and a disk figure off a broker - neither of which this family reports.
  it("is its own list rather than the default", () => {
    expect(rulesFor(MQKind.KindPulsar)).not.toEqual(rulesFor(MQKind.KindRocketMQ));
  });
});
