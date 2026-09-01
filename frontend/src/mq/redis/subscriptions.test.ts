import { describe, expect, it } from "vitest";
import type { Subscription } from "@bindings/model/models";
import {
  consumerCount,
  entriesRead,
  groupKey,
  groupName,
  groupStream,
  health,
  lag,
  lastDeliveredId,
  pending,
} from "./subscriptions";

function group(
  attributes: Record<string, string>,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: 1,
    ref: { namespace: "orders:events", name: "settle-group" },
    status: "online",
    members: 2,
    destinations: 1,
    backlog: 29,
    rateOut: -1,
    lastUpdated: "",
    attributes,
    ...overrides,
  } as unknown as Subscription;
}

describe("the Redis consumer group readers", () => {
  it("reads both halves of the group's identity", () => {
    const subscription = group({});
    expect(groupName(subscription)).toBe("settle-group");
    expect(groupStream(subscription)).toBe("orders:events");
    expect(consumerCount(subscription)).toBe(2);
  });

  /*
   * A group name is unique only within its stream, so two streams may each
   * hold a "settle-group" and they are unrelated objects. A list keyed on the
   * name alone would show one row for both and send an operation to whichever
   * came first.
   */
  it("keys a group by its stream and its name together", () => {
    const onOrders = group({});
    const onPayments = group({}, { ref: { namespace: "payments:captured", name: "settle-group" } });
    expect(groupKey(onOrders)).not.toBe(groupKey(onPayments));
  });

  it("reads the pending count, the position and entries-read", () => {
    const subscription = group({
      pending: "29",
      lastDeliveredId: "1756454641773-2",
      entriesRead: "1204742",
    });
    expect(pending(subscription)).toBe(29);
    expect(lastDeliveredId(subscription)).toBe("1756454641773-2");
    expect(entriesRead(subscription)).toBe(1204742);
  });

  it("reads the lag off the canonical backlog", () => {
    expect(lag(group({}))).toBe(29);
    expect(lag(group({}, { backlog: 0 }))).toBe(0);
  });

  /*
   * The distinction the module exists for. Redis stops being able to count the
   * lag once entries a group had not read are deleted, and says so with nil -
   * which the driver passes through as UnknownMetric. Rendering that as a zero
   * would report a group that is arbitrarily far behind as caught up.
   */
  it("reads an uncountable lag as null, not as zero", () => {
    expect(lag(group({}, { backlog: -1 }))).toBeNull();
    // entries-read goes with it: the driver only sends it when the pair is
    // known, so an absent one must not become a zero either.
    expect(entriesRead(group({}))).toBeNull();
  });

  describe("what an operator should look at first", () => {
    it("is consuming while anything is attached", () => {
      expect(health(group({ pending: "0" }))).toBe("consuming");
      expect(health(group({ pending: "40" }))).toBe("consuming");
    });

    /*
     * The middle state. Nothing is attached and entries are still owed: that
     * work was handed out and never acknowledged, and nothing is coming back
     * for it until something attaches or claims it.
     */
    it("is stalled with nothing attached and entries still owed", () => {
      expect(health(group({ pending: "12" }, { members: 0 }))).toBe("stalled");
    });

    /*
     * And this is the one it must not be confused with: an application that is
     * simply not running, which is often exactly as intended.
     */
    it("is idle with nothing attached and nothing owed", () => {
      expect(health(group({ pending: "0" }, { members: 0 }))).toBe("idle");
      expect(health(group({}, { members: 0 }))).toBe("idle");
    });
  });
});
