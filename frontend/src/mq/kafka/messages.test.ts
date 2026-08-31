import { describe, expect, it } from "vitest";
import type { MessageItem } from "@bindings/model/models";
import {
  formatValue,
  hasKey,
  headerCount,
  headersOf,
  isTombstone,
  keyOf,
  shapeOf,
} from "./messages";

const record = (over: Partial<MessageItem> = {}): MessageItem =>
  ({
    id: 1,
    topic: "orders",
    messageId: "orders-0-42",
    keys: "ORD-1",
    queueId: 0,
    queueOffset: 42,
    storeTime: "",
    storeTimestamp: 0,
    status: "normal",
    body: "",
    properties: {},
    ...over,
  }) as unknown as MessageItem;

/*
 * Kafka picks a partition from the key, so a record with no key at all is
 * spread across partitions while one with an empty key is pinned like any
 * other. Rendering both as "" would hide why two records that look identical
 * went to different places.
 */
describe("a record's key", () => {
  it("tells no key apart from an empty key", () => {
    const none = record({ keys: "\u0000__mqs_null_key" });
    const empty = record({ keys: "" });

    expect(hasKey(none)).toBe(false);
    expect(hasKey(empty)).toBe(true);
    expect(keyOf(none)).toBe("");
    expect(keyOf(empty)).toBe("");
  });

  it("reads an ordinary key straight through", () => {
    expect(keyOf(record({ keys: "ORD-1" }))).toBe("ORD-1");
  });
});

/*
 * A Kafka record carries bytes and nothing about what is in them - there is no
 * content type anywhere in the protocol - so how a value is drawn is a guess,
 * and the board says so rather than presenting it as a declaration.
 */
describe("guessing what a value is", () => {
  it("recognises JSON", () => {
    expect(shapeOf('{"id":1}')).toBe("json");
    expect(shapeOf("[1,2,3]")).toBe("json");
    expect(shapeOf('  {"id":1}  ')).toBe("json");
  });

  it("calls something that only looks like JSON text", () => {
    expect(shapeOf("{not json}")).toBe("text");
  });

  it("recognises plain text", () => {
    expect(shapeOf("hello")).toBe("text");
    expect(shapeOf("a\nb\tc")).toBe("text");
  });

  it("recognises bytes that are not characters", () => {
    // A NUL and an SOH: Avro and protobuf both start like this, and neither
    // is something this app decodes.
    expect(shapeOf("\u0000\u0001binary")).toBe("binary");
  });

  it("recognises an empty value", () => {
    expect(shapeOf("")).toBe("empty");
  });
});

describe("formatting a value", () => {
  it("pretty-prints JSON", () => {
    expect(formatValue('{"id":1}')).toBe('{\n  "id": 1\n}');
  });

  it("leaves everything else exactly as it is", () => {
    expect(formatValue("hello")).toBe("hello");
    expect(formatValue("{not json}")).toBe("{not json}");
  });
});

describe("headers", () => {
  it("reads the canonical properties map", () => {
    const source = record({ properties: { "trace-id": "abc", source: "checkout" } });
    expect(headersOf(source)).toEqual({ "trace-id": "abc", source: "checkout" });
    expect(headerCount(source)).toBe(2);
  });

  it("survives a record with none", () => {
    expect(headersOf(record({ properties: {} }))).toEqual({});
    expect(headerCount(record({ properties: {} }))).toBe(0);
  });
});

/*
 * A tombstone is a key with no value, which tells a compacted topic to forget
 * that key. It is not an empty message and a board that drew it as one would
 * hide a deletion.
 */
describe("tombstones", () => {
  it("is a key with no value", () => {
    expect(isTombstone(record({ keys: "ORD-1", body: "" }))).toBe(true);
  });

  it("is not a keyless record with no value", () => {
    expect(isTombstone(record({ keys: "\u0000__mqs_null_key", body: "" }))).toBe(false);
  });

  it("is not a key with a value", () => {
    expect(isTombstone(record({ keys: "ORD-1", body: "x" }))).toBe(false);
  });
});
