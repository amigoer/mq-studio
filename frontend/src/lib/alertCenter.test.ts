import { describe, expect, it } from "vitest";
import {
  RESOLVED_RETENTION_MS,
  mergeAlerts,
  recordId,
  unreadCount,
  type AlertRecord,
} from "./alertCenter";
import type { DerivedAlert } from "./alertDerive";

const CONN = 7;
const T0 = 1_700_000_000_000;

const lag = (value = 12_043): DerivedAlert => ({
  key: "group-lag-order-settle",
  ruleKey: "groupLag",
  severity: "warn",
  params: { group: "order-settle", lag: value, threshold: 10_000 },
});

const disk: DerivedAlert = {
  key: "disk-broker-b-1",
  ruleKey: "diskUsage",
  severity: "warn",
  params: { broker: "broker-b-1", usage: 87, threshold: 85 },
};

function merge(
  previous: Record<string, AlertRecord>,
  observed: [number, DerivedAlert[]][],
  options: { known?: number[]; read?: string[]; now?: number } = {},
) {
  return mergeAlerts({
    previous,
    observed: new Map(observed),
    known: new Set(options.known ?? [CONN]),
    read: new Set(options.read ?? []),
    now: options.now ?? T0,
  });
}

describe("mergeAlerts", () => {
  it("records a new alert as unread and announces it", () => {
    const { records, fired } = merge({}, [[CONN, [lag()]]]);
    const id = recordId(CONN, lag().key);

    expect(Object.keys(records)).toEqual([id]);
    expect(records[id]).toMatchObject({ read: false, firstSeen: T0, lastSeen: T0 });
    expect(records[id]?.resolvedAt).toBeUndefined();
    expect(fired.map((f) => f.id)).toEqual([id]);
  });

  it("keeps firstSeen and read state while it goes on firing", () => {
    const first = merge({}, [[CONN, [lag()]]]).records;
    const id = recordId(CONN, lag().key);
    first[id] = { ...first[id]!, read: true };

    // A later poll, with the backlog grown.
    const { records, fired } = merge(first, [[CONN, [lag(15_000)]]], {
      now: T0 + 60_000,
    });

    expect(records[id]).toMatchObject({
      firstSeen: T0,
      lastSeen: T0 + 60_000,
      read: true,
    });
    expect(records[id]?.params.lag).toBe(15_000);
    expect(fired).toEqual([]);
  });

  it("resolves an alert the connection no longer reports", () => {
    const first = merge({}, [[CONN, [lag()]]]).records;
    const { records, fired } = merge(first, [[CONN, []]], { now: T0 + 60_000 });

    expect(records[recordId(CONN, lag().key)]?.resolvedAt).toBe(T0 + 60_000);
    expect(fired).toEqual([]);
  });

  it("leaves records alone when the poll failed", () => {
    const first = merge({}, [[CONN, [lag()]]]).records;
    // The connection is absent from `observed`, which is what a failed sweep
    // looks like -- as opposed to an empty list, which means "nothing wrong".
    const { records } = merge(first, [], { now: T0 + 60_000 });

    expect(records[recordId(CONN, lag().key)]?.resolvedAt).toBeUndefined();
  });

  it("treats a recovered alert that comes back as new and unread", () => {
    const firing = merge({}, [[CONN, [lag()]]]).records;
    const id = recordId(CONN, lag().key);
    firing[id] = { ...firing[id]!, read: true };
    const resolved = merge(firing, [[CONN, []]], { now: T0 + 60_000 }).records;
    expect(resolved[id]?.resolvedAt).toBe(T0 + 60_000);

    const { records, fired } = merge(resolved, [[CONN, [lag()]]], {
      now: T0 + 120_000,
    });

    expect(records[id]).toMatchObject({ read: false, firstSeen: T0 + 120_000 });
    expect(records[id]?.resolvedAt).toBeUndefined();
    expect(fired.map((f) => f.id)).toEqual([id]);
  });

  it("honours the stored read set, so a standing alert is quiet on relaunch", () => {
    const id = recordId(CONN, lag().key);
    const { records, fired } = merge({}, [[CONN, [lag()]]], { read: [id] });

    expect(records[id]?.read).toBe(true);
    expect(fired).toEqual([]);
  });

  it("forgets records of a connection that no longer exists", () => {
    const first = merge({}, [[CONN, [lag()]]]).records;
    const { records } = merge(first, [], { known: [] });

    expect(records).toEqual({});
  });

  it("drops a recovery once it is older than the retention window", () => {
    const firing = merge({}, [[CONN, [lag()]]]).records;
    const resolved = merge(firing, [[CONN, []]], { now: T0 + 1000 }).records;

    const kept = merge(resolved, [], { now: T0 + 1000 + RESOLVED_RETENTION_MS });
    expect(Object.keys(kept.records)).toHaveLength(1);

    const dropped = merge(resolved, [], {
      now: T0 + 2000 + RESOLVED_RETENTION_MS,
    });
    expect(dropped.records).toEqual({});
  });

  it("keeps connections apart", () => {
    const { records } = merge({}, [
      [CONN, [lag()]],
      [8, [lag()]],
    ], { known: [CONN, 8] });

    expect(Object.keys(records).sort()).toEqual(
      [recordId(CONN, lag().key), recordId(8, lag().key)].sort(),
    );
  });

  it("resolves one rule without touching another that still fires", () => {
    const both = merge({}, [[CONN, [lag(), disk]]]).records;
    const { records } = merge(both, [[CONN, [disk]]], { now: T0 + 60_000 });

    expect(records[recordId(CONN, lag().key)]?.resolvedAt).toBe(T0 + 60_000);
    expect(records[recordId(CONN, disk.key)]?.resolvedAt).toBeUndefined();
  });
});

describe("unreadCount", () => {
  it("counts only what is firing and unseen", () => {
    const firing = merge({}, [[CONN, [lag(), disk]]]).records;
    expect(unreadCount(firing)).toBe(2);

    const resolved = merge(firing, [[CONN, [disk]]], { now: T0 + 60_000 }).records;
    expect(unreadCount(resolved)).toBe(1);

    const read = Object.fromEntries(
      Object.entries(resolved).map(([id, record]) => [id, { ...record, read: true }]),
    );
    expect(unreadCount(read)).toBe(0);
  });
});
