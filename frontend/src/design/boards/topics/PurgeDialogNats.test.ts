import { describe, expect, it } from "vitest";
import { purgeInputOf } from "./PurgeDialogNats";

/**
 * The two mistakes this form prevents are both quiet ones.
 *
 * A blank keep-count is not zero. Zero empties the stream, so a form that read
 * an untouched field as "keep none" would be the most destructive default in
 * the app - and it would look like a slip of the finger rather than a command.
 *
 * A sequence is one number for the whole stream. Somebody arriving from Redis
 * will type an entry id, and the server would answer with a parse failure that
 * says nothing about which shape this family wants.
 */
describe("what the purge dialog will send", () => {
  it("keeps the newest N when a count was typed", () => {
    expect(purgeInputOf("ORDERS", "maxlen", "1000", "")).toEqual({
      stream: "ORDERS",
      strategy: "maxlen",
      keep: 1000,
      sequence: "",
    });
  });

  it("refuses to send anything while the count is blank", () => {
    expect(purgeInputOf("ORDERS", "maxlen", "", "")).toBeNull();
    expect(purgeInputOf("ORDERS", "maxlen", "   ", "")).toBeNull();
  });

  /* Zero is a command, not an empty field, and it has to reach the server. */
  it("sends a zero, because keeping none is how a stream is emptied", () => {
    expect(purgeInputOf("ORDERS", "maxlen", "0", "")).toEqual({
      stream: "ORDERS",
      strategy: "maxlen",
      keep: 0,
      sequence: "",
    });
  });

  it("refuses a count that is not a whole number of messages", () => {
    for (const keep of ["-1", "1.5", "1e3", "lots", "10 "]) {
      // "10 " is trimmed and accepted; everything else is not a count.
      const result = purgeInputOf("ORDERS", "maxlen", keep, "");
      if (keep === "10 ") {
        expect(result).not.toBeNull();
      } else {
        expect(result, keep).toBeNull();
      }
    }
  });

  it("keeps everything from a sequence when one was typed", () => {
    expect(purgeInputOf("ORDERS", "minid", "", "4096")).toEqual({
      stream: "ORDERS",
      strategy: "minid",
      keep: 0,
      sequence: "4096",
    });
  });

  it("refuses an entry id from another family", () => {
    // Redis's shape, which is the one somebody will paste.
    expect(purgeInputOf("ORDERS", "minid", "", "1699999999999-0")).toBeNull();
    expect(purgeInputOf("ORDERS", "minid", "", "")).toBeNull();
    expect(purgeInputOf("ORDERS", "minid", "", "-1")).toBeNull();
  });
});
