import { describe, expect, it } from "vitest";
import { streamKeyOf } from "./StreamDialog";

/**
 * A Redis stream has no settings, so this form has exactly one rule and one
 * way to get it wrong: a key with surrounding whitespace is a different key,
 * and Redis would accept it without a word - leaving a stream in the list that
 * looks like the one the user meant and is not.
 */
describe("the stream key a create dialog submits", () => {
  it("refuses an empty key", () => {
    expect(streamKeyOf("")).toBeNull();
    expect(streamKeyOf("   ")).toBeNull();
  });

  it("trims what was typed", () => {
    expect(streamKeyOf("  orders:events  ")).toBe("orders:events");
  });

  /*
   * A colon is Redis's own namespacing convention, and braces are the hash-tag
   * syntax that pins a key to one cluster slot. Neither is special to a key
   * name, and a form that rejected them would refuse the two things a Redis
   * user is most likely to type.
   */
  it("keeps the characters a redis key is made of", () => {
    expect(streamKeyOf("orders:events")).toBe("orders:events");
    expect(streamKeyOf("orders.events-2")).toBe("orders.events-2");
    expect(streamKeyOf("{tenant-a}:orders")).toBe("{tenant-a}:orders");
  });
});
