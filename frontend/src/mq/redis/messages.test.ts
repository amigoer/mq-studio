import { describe, expect, it } from "vitest";
import type { MessageItem } from "@bindings/model/models";
import { addedAt, asJson, entryId, fieldCount, fields, streamOf, summary } from "./messages";

function entry(properties: Record<string, string>, overrides: Partial<MessageItem> = {}) {
  return {
    id: 1,
    topic: "orders:events",
    messageId: "1756454646018-3",
    body: JSON.stringify(properties),
    queueId: 0,
    queueOffset: 0,
    storeTime: "2026-08-29 14:24:06",
    storeTimestamp: 1756454646018,
    status: "normal",
    properties,
    ...overrides,
  } as unknown as MessageItem;
}

describe("the Redis entry readers", () => {
  it("reads the id, the stream and the time", () => {
    const item = entry({ order: "A-1001" });
    expect(entryId(item)).toBe("1756454646018-3");
    expect(streamOf(item)).toBe("orders:events");
    expect(addedAt(item)).toBe("2026-08-29 14:24:06");
  });

  /*
   * The fields are the message. Their written order is not recoverable - the
   * client hands them back as a map - so they are sorted, which is at least
   * stable between two reads of the same entry.
   */
  it("lists the fields in name order", () => {
    const item = entry({ total: "42.50", order: "A-1001", currency: "CNY" });
    expect(fields(item).map((field) => field.name)).toEqual(["currency", "order", "total"]);
    expect(fieldCount(item)).toBe(3);
  });

  it("handles an entry with no fields", () => {
    const item = entry({});
    expect(fields(item)).toEqual([]);
    expect(fieldCount(item)).toBe(0);
    expect(summary(item)).toBe("");
  });

  describe("the one-line preview", () => {
    it("shows the first few fields", () => {
      const item = entry({ a: "1", b: "2" });
      expect(summary(item)).toBe("a=1  b=2");
    });

    /*
     * It has to read as a summary. An entry with twenty fields rendered in one
     * cell would look like the whole entry, and the reader would not know the
     * panel had more.
     */
    it("says how many it left out", () => {
      const item = entry({ a: "1", b: "2", c: "3", d: "4", e: "5" });
      expect(summary(item)).toBe("a=1  b=2  c=3  +2");
    });

    it("truncates a long value rather than filling the row with it", () => {
      const item = entry({ payload: "x".repeat(80) });
      const line = summary(item);
      expect(line.length).toBeLessThan(40);
      expect(line).toContain("…");
    });
  });

  /*
   * The body is a rendering of the whole entry rather than one of its fields:
   * Redis has no convention naming one the payload, so the copy control hands
   * over everything the entry holds.
   */
  it("copies the whole entry as json", () => {
    const item = entry({ order: "A-1001", total: "42.50" });
    expect(JSON.parse(asJson(item))).toEqual({ order: "A-1001", total: "42.50" });
  });
});
