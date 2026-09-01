import { describe, expect, it } from "vitest";
import type { GroupConsumer, PendingEntry, PendingSummary } from "@bindings/model/models";
import {
  ABANDONED_AFTER_MS,
  consumerHealth,
  consumerInactiveMs,
  dominantConsumer,
  formatIdle,
  newestPendingId,
  oldestPendingId,
  pendingKey,
} from "./pending";

const entry = (over: Partial<PendingEntry> = {}) =>
  ({
    ref: { namespace: "orders:events", name: "settle-group" },
    id: "1756454646018-0",
    consumer: "worker-1",
    idleMs: 1200,
    deliveries: 1,
    ...over,
  }) as unknown as PendingEntry;

const consumer = (over: Partial<GroupConsumer> = {}) =>
  ({ name: "worker-1", pending: 6, idleMs: 1200, inactiveMs: 0, ...over }) as unknown as GroupConsumer;

const summary = (over: Partial<PendingSummary> = {}) =>
  ({
    ref: { namespace: "orders:events", name: "settle-group" },
    count: 10,
    minId: "1756454640000-0",
    maxId: "1756454646018-0",
    perConsumer: [{ consumer: "worker-1", count: 8 }, { consumer: "worker-2", count: 2 }],
    ...over,
  }) as unknown as PendingSummary;

describe("the Redis pending readers", () => {
  /*
   * An id is unique within a stream, and a group name within a stream too, so
   * a table showing several groups at once needs all three or two rows for the
   * same id on different streams would collide.
   */
  it("keys an entry by its stream, its group and its id", () => {
    const onOrders = entry();
    const onPayments = entry({ ref: { namespace: "payments:captured", name: "settle-group" } });
    expect(pendingKey(onOrders)).not.toBe(pendingKey(onPayments));
  });

  /*
   * An empty pending list has no oldest entry. Redis answers 0-0 at both ends
   * rather than omitting them, and an id on the page for a list that has none
   * reads as a real entry somebody could go and look at.
   */
  it("reads the bounds of an empty list as absent", () => {
    const empty = summary({ count: 0, minId: "", maxId: "" });
    expect(oldestPendingId(empty)).toBeNull();
    expect(newestPendingId(empty)).toBeNull();

    expect(oldestPendingId(summary())).toBe("1756454640000-0");
    expect(newestPendingId(summary())).toBe("1756454646018-0");
  });

  /*
   * The distinction the summary exists for. One dead consumer holding
   * everything and a group that is generally behind look identical in the
   * total and need completely different things done about them.
   */
  it("names a consumer holding most of what the group is owed", () => {
    expect(dominantConsumer(summary())).toEqual({ consumer: "worker-1", count: 8 });

    const spread = summary({
      perConsumer: [
        { consumer: "worker-1", count: 4 },
        { consumer: "worker-2", count: 3 },
        { consumer: "worker-3", count: 3 },
      ],
    });
    expect(dominantConsumer(spread)).toBeNull();
    expect(dominantConsumer(summary({ count: 0, perConsumer: [] }))).toBeNull();
  });

  describe("what a consumer looks like it is doing", () => {
    it("is idle when it holds nothing, however long it has been quiet", () => {
      expect(consumerHealth(consumer({ pending: 0, idleMs: 86_400_000 }))).toBe("idle");
    });

    it("is working while it holds something and has read recently", () => {
      expect(consumerHealth(consumer({ pending: 6, idleMs: 1200 }))).toBe("working");
    });

    /*
     * The state the page exists to surface: entries owed to something that has
     * not read anything in a long time. Nothing is coming back for them on its
     * own.
     */
    it("is abandoned when it holds something and has been quiet too long", () => {
      expect(consumerHealth(consumer({ pending: 6, idleMs: ABANDONED_AFTER_MS }))).toBe(
        "abandoned",
      );
      expect(consumerHealth(consumer({ pending: 6, idleMs: 30_000 }), 10_000)).toBe("abandoned");
    });
  });

  /*
   * Inactive is Redis 7.2 and later. An older server reports nothing, and that
   * is "not reported" rather than "active a moment ago" - a zero would make an
   * old server's consumers all look freshly busy.
   */
  it("reads an unreported inactive time as null", () => {
    expect(consumerInactiveMs(consumer({ inactiveMs: 0 }))).toBeNull();
    expect(consumerInactiveMs(consumer({ inactiveMs: 4500 }))).toBe(4500);
  });

  /*
   * The column exists so a glance separates work in flight from work that is
   * stuck, which seven-digit millisecond counts do not.
   */
  describe("the idle column", () => {
    it("scales to the unit a reader thinks in", () => {
      expect(formatIdle(0)).toBe("0ms");
      expect(formatIdle(940)).toBe("940ms");
      expect(formatIdle(1_200)).toBe("1.2s");
      expect(formatIdle(45_000)).toBe("45s");
      expect(formatIdle(90_000)).toBe("1.5m");
      expect(formatIdle(3_600_000)).toBe("1.0h");
      expect(formatIdle(7_560_000)).toBe("2.1h");
      expect(formatIdle(172_800_000)).toBe("2.0d");
    });

    // A clock that moved backwards between two reads must not print a negative
    // age next to an entry that plainly exists.
    it("never renders a negative age", () => {
      expect(formatIdle(-5)).toBe("0ms");
    });
  });
});
