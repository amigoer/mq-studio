import { describe, expect, it } from "vitest";
import { parseLimit } from "./NamespaceLimitsPulsar";

/*
 * A blank field is not a zero.
 *
 * Clearing a limit hands it back to the broker's own default, which is a
 * different call from setting it to zero - and zero producers is a namespace
 * nothing can publish to. If a blank parsed as 0 the panel would silently stop
 * publishing on any namespace whose limit somebody tried to clear.
 */
describe("the limit a row will submit", () => {
  it("treats a blank field as a request to remove the limit", () => {
    expect(parseLimit("")).toEqual({ error: "blank" });
    expect(parseLimit("   ")).toEqual({ error: "blank" });
  });

  it("keeps an explicit zero, which is a real cap", () => {
    expect(parseLimit("0")).toEqual({ value: 0 });
  });

  it("accepts a plain integer", () => {
    expect(parseLimit("3600")).toEqual({ value: 3600 });
    expect(parseLimit("  60  ")).toEqual({ value: 60 });
  });

  // Pulsar takes an int and refuses a negative one, so the field does too
  // rather than sending it and reporting the broker's own wording.
  it("refuses a negative", () => {
    expect(parseLimit("-1")).toEqual({ error: "invalid" });
  });

  /*
   * parseInt stops at the first character it cannot read, so "60s" would
   * become 60 and "1e3" would become 1. Both would submit a number the user
   * never typed, which is worse than refusing the field.
   */
  it("refuses anything parseInt would silently truncate", () => {
    expect(parseLimit("60s")).toEqual({ error: "invalid" });
    expect(parseLimit("1e3")).toEqual({ error: "invalid" });
    expect(parseLimit("3.5")).toEqual({ error: "invalid" });
    expect(parseLimit("abc")).toEqual({ error: "invalid" });
  });
});
