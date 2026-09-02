import { describe, expect, it } from "vitest";
import { Subscription, SubscriptionRef } from "@bindings/model/models";
import {
  isBlocked,
  isDurable,
  shortTopicOf,
  subscriptionType,
  topicOf,
  unackedCount,
  validateSubscriptionName,
} from "./subscriptions";

const t = (key: string) => key;

const subscription = (
  topic: string,
  name: string,
  attributes: Record<string, string> = {},
): Subscription =>
  new Subscription({
    ref: new SubscriptionRef({ namespace: topic, name }),
    attributes,
  });

/*
 * A subscription's topic is half its identity.
 *
 * Two topics can each have one called "shared" and they are unrelated. Losing
 * the topic would collapse them into one row and aim every action at whichever
 * the driver found first.
 */
describe("a subscription's topic", () => {
  it("comes out of the ref", () => {
    const row = subscription("persistent://public/default/orders", "shared");
    expect(topicOf(row)).toBe("persistent://public/default/orders");
    expect(shortTopicOf(row)).toBe("orders");
  });

  // The attribute is the fallback for anything that built a ref without one.
  it("falls back to the attribute", () => {
    const row = subscription("", "shared", {
      pulsarSubscriptionTopic: "persistent://public/default/orders",
    });
    expect(topicOf(row)).toBe("persistent://public/default/orders");
  });
});

/*
 * Blocked is not a deep backlog.
 *
 * Past the unacked limit the broker stops delivering entirely. From the
 * backlog alone that is indistinguishable from a slow consumer, and the two
 * are fixed in completely different places.
 */
describe("a blocked subscription", () => {
  it("is read from its own flag, not from the backlog", () => {
    expect(isBlocked(subscription("t", "s"))).toBe(false);
    expect(isBlocked(subscription("t", "s", { pulsarSubscriptionBlocked: "true" }))).toBe(true);
  });

  it("carries the unacked count behind it", () => {
    expect(unackedCount(subscription("t", "s"))).toBeNull();
    expect(unackedCount(subscription("t", "s", { pulsarSubscriptionUnacked: "0" }))).toBe(0);
    expect(unackedCount(subscription("t", "s", { pulsarSubscriptionUnacked: "50000" }))).toBe(
      50000,
    );
  });
});

/*
 * Durability decides whether a reset has anything to move.
 *
 * A non-durable subscription is a reader's own position and vanishes when it
 * disconnects, so it defaults to durable - the driver only writes "false" for
 * the case that is not.
 */
describe("whether the cursor is stored", () => {
  it("defaults to durable", () => {
    expect(isDurable(subscription("t", "s"))).toBe(true);
  });

  it("reads the non-durable marker", () => {
    expect(isDurable(subscription("t", "s", { pulsarSubscriptionDurable: "false" }))).toBe(false);
  });
});

// The type is reported, never chosen here: the consumers that attach decide it.
describe("the subscription type", () => {
  it("is whatever the broker said", () => {
    expect(subscriptionType(subscription("t", "s", { pulsarSubscriptionType: "Key_Shared" }))).toBe(
      "Key_Shared",
    );
    expect(subscriptionType(subscription("t", "s"))).toBe("");
  });
});

/*
 * The name goes straight into a URL path, so the form catches what would
 * address something else.
 */
describe("what the subscription form refuses", () => {
  it("needs a name", () => {
    expect(validateSubscriptionName("", t)).toBe("board.consumers.pulsar.nameRequired");
    expect(validateSubscriptionName("  ", t)).toBe("board.consumers.pulsar.nameRequired");
  });

  it("refuses a slash or a space", () => {
    expect(validateSubscriptionName("a/b", t)).toBe("board.consumers.pulsar.nameInvalid");
    expect(validateSubscriptionName("order processor", t)).toBe(
      "board.consumers.pulsar.nameInvalid",
    );
  });

  it("accepts an ordinary name", () => {
    expect(validateSubscriptionName("order-processor", t)).toBeNull();
  });
});
