import { describe, expect, it } from "vitest";
import {
  emptyResetOffsetDraft,
  toResetInput,
  validateResetOffsetDraft,
  type ResetOffsetDraft,
} from "./ResetOffsetDialogKafka";

const draft = (over: Partial<ResetOffsetDraft> = {}): ResetOffsetDraft => ({
  ...emptyResetOffsetDraft("orders"),
  ...over,
});

/*
 * Each target needs a different field, and validating them together is what
 * stops a reset to "offset" going out with no offset in it - which Kafka would
 * take as offset zero and replay the whole topic.
 */
describe("the Kafka offset reset form", () => {
  it("needs a topic whatever the target", () => {
    expect(validateResetOffsetDraft(draft({ topic: "" }))).toBe("topicRequired");
    expect(validateResetOffsetDraft(draft({ topic: "  " }))).toBe("topicRequired");
  });

  it("asks for nothing more for earliest and latest", () => {
    expect(validateResetOffsetDraft(draft({ target: "earliest" }))).toBeNull();
    expect(validateResetOffsetDraft(draft({ target: "latest" }))).toBeNull();
  });

  it("needs a valid moment for a timestamp reset", () => {
    expect(validateResetOffsetDraft(draft({ target: "timestamp" }))).toBe("timestampRequired");
    expect(validateResetOffsetDraft(draft({ target: "timestamp", timestamp: "yesterday" })))
      .toBe("timestampInvalid");
    expect(validateResetOffsetDraft(draft({ target: "timestamp", timestamp: "2026-08-31T10:00" })))
      .toBeNull();
  });

  it("needs a number for an offset or a shift", () => {
    expect(validateResetOffsetDraft(draft({ target: "offset" }))).toBe("valueRequired");
    expect(validateResetOffsetDraft(draft({ target: "offset", value: "ten" }))).toBe("valueInvalid");
    expect(validateResetOffsetDraft(draft({ target: "offset", value: "10" }))).toBeNull();
  });

  // An absolute offset cannot be negative; a shift is signed on purpose,
  // because going back is most of what a shift is for.
  it("refuses a negative offset but accepts a negative shift", () => {
    expect(validateResetOffsetDraft(draft({ target: "offset", value: "-1" }))).toBe("valueNegative");
    expect(validateResetOffsetDraft(draft({ target: "shift", value: "-100" }))).toBeNull();
    expect(validateResetOffsetDraft(draft({ target: "shift", value: "+100" }))).toBeNull();
  });

  // A shift of zero is a reset that changes nothing, which is never what was
  // meant and would still stop the consumers for no reason.
  it("refuses a shift of zero", () => {
    expect(validateResetOffsetDraft(draft({ target: "shift", value: "0" }))).toBe("shiftZero");
  });
});

describe("the submitted reset", () => {
  it("sends only the field its target uses", () => {
    const latest = toResetInput("g", draft({ target: "latest" }));
    expect(latest).toMatchObject({ group: "g", topic: "orders", target: "latest", timestamp: 0, value: 0 });

    const offset = toResetInput("g", draft({ target: "offset", value: "42" }));
    expect(offset.value).toBe(42);
    expect(offset.timestamp).toBe(0);

    const shift = toResetInput("g", draft({ target: "shift", value: "-100" }));
    expect(shift.value).toBe(-100);
  });

  it("sends a timestamp as milliseconds", () => {
    const input = toResetInput("g", draft({ target: "timestamp", timestamp: "2026-08-31T10:00" }));
    expect(input.timestamp).toBe(Date.parse("2026-08-31T10:00"));
    expect(input.value).toBe(0);
  });

  // Empty means every partition, which is what the form offers: narrowing to
  // one partition is the detail panel's job, not this dialog's.
  it("resets every partition of the topic", () => {
    expect(toResetInput("g", draft()).partitions).toEqual([]);
  });
});
