import { describe, expect, it } from "vitest";
import {
  emptyKafkaSendDraft,
  toKafkaRecordInput,
  validateKafkaSendDraft,
  type KafkaSendDraft,
} from "./producerKafkaDraft";

const draft = (over: Partial<KafkaSendDraft> = {}): KafkaSendDraft => ({
  ...emptyKafkaSendDraft(),
  topic: "orders",
  ...over,
});

describe("the Kafka send form", () => {
  it("needs a topic", () => {
    expect(validateKafkaSendDraft(draft({ topic: "" }))).toBe("topicRequired");
  });

  // Blank means "let the key decide", which is what ordering by key depends
  // on. A number input would collapse that into partition zero.
  it("takes a blank partition as by-key", () => {
    expect(validateKafkaSendDraft(draft({ partition: "" }))).toBeNull();
    expect(toKafkaRecordInput(draft({ partition: "" })).partition).toBe(-1);
    expect(toKafkaRecordInput(draft({ partition: "0" })).partition).toBe(0);
  });

  it("refuses a partition that is not a whole non-negative number", () => {
    expect(validateKafkaSendDraft(draft({ partition: "-1" }))).toBe("partitionInvalid");
    expect(validateKafkaSendDraft(draft({ partition: "two" }))).toBe("partitionInvalid");
  });

  it("bounds how many copies one press can send", () => {
    expect(validateKafkaSendDraft(draft({ count: "0" }))).toBe("countInvalid");
    expect(validateKafkaSendDraft(draft({ count: "10001" }))).toBe("countInvalid");
    expect(validateKafkaSendDraft(draft({ count: "1000" }))).toBeNull();
  });

  it("refuses a header line that is not key=value", () => {
    expect(validateKafkaSendDraft(draft({ headers: "nonsense" }))).toBe("headerLine");
    expect(validateKafkaSendDraft(draft({ headers: "trace-id=abc" }))).toBeNull();
  });
});

/*
 * A record with no key at all is spread across partitions; one with an empty
 * key is pinned like any other. The switch is what separates them, and the key
 * field's leftover text must not leak through when it is off.
 */
describe("the submitted record", () => {
  it("sends no key when the switch is off", () => {
    const input = toKafkaRecordInput(draft({ withKey: false, key: "left over" }));
    expect(input.hasKey).toBe(false);
    expect(input.key).toBe("");
  });

  it("sends an empty key when the switch is on and the field is blank", () => {
    const input = toKafkaRecordInput(draft({ withKey: true, key: "" }));
    expect(input.hasKey).toBe(true);
    expect(input.key).toBe("");
  });

  it("carries the value, headers and acks as given", () => {
    const input = toKafkaRecordInput(
      draft({
        value: '{"id":1}',
        headers: "trace-id=abc\nsource=checkout",
        acks: "leader",
        count: "5",
      }),
    );
    expect(input.value).toBe('{"id":1}');
    expect(input.headers).toEqual({ "trace-id": "abc", source: "checkout" });
    expect(input.acks).toBe("leader");
    expect(input.count).toBe(5);
  });

  // Zero lets the producer stamp it, and a topic set to LogAppendTime
  // overrides whatever the client sent anyway.
  it("lets the producer stamp the timestamp", () => {
    expect(toKafkaRecordInput(draft()).timestamp).toBe(0);
  });
});
