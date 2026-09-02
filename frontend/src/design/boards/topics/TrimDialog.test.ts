import { describe, expect, it } from "vitest";
import { empties, emptyTrimForm, toRequest, validate } from "./TrimDialog";

const t = (key: string) => key;

/**
 * A trim is not reversible and the two strategies discard different things, so
 * everything here is about the values rather than about the button: a length
 * field that read as NaN would become a trim to zero, which empties the stream
 * the user was shortening.
 */
describe("the trim request", () => {
  it("defaults to a length bound, approximately, with nothing filled in", () => {
    const form = emptyTrimForm();
    expect(form.strategy).toBe("maxlen");
    expect(form.maxLen).toBe("");
    // Redis's own documentation recommends the approximate form: the exact one
    // has to split a macro node and is far more expensive on the large streams
    // anyone actually needs to trim.
    expect(form.approx).toBe(true);
    expect(validate(form, t)).toBe("board.topics.redis.trim.lengthRequired");
  });

  it("refuses a length that is not a whole non-negative number", () => {
    // "1e3" is the one worth naming: Number.isInteger calls it an integer, so
    // a check built on Number would have turned it into 1000 without saying so
    // - on an operation with no undo.
    for (const maxLen of ["-1", "1.5", "ten", "1e3", " ", "0x10", "1 000"]) {
      const form = { ...emptyTrimForm(), maxLen };
      expect(validate(form, t), maxLen).not.toBeNull();
    }
  });

  it("accepts a length, and zero among them", () => {
    expect(validate({ ...emptyTrimForm(), maxLen: "10000" }, t)).toBeNull();
    // Zero is a real answer, not a blank one: it is the only way Redis empties
    // a stream without deleting the key.
    expect(validate({ ...emptyTrimForm(), maxLen: "0" }, t)).toBeNull();
  });

  it("names the case that empties the stream, so the dialog can warn", () => {
    expect(empties({ ...emptyTrimForm(), maxLen: "0" })).toBe(true);
    expect(empties({ ...emptyTrimForm(), maxLen: "1" })).toBe(false);
    // A position bound cannot empty a stream: an id keeps everything from it
    // onwards, and there is always at least what arrives next.
    expect(empties({ ...emptyTrimForm(), strategy: "minid", minId: "0-0" })).toBe(false);
  });

  it("refuses an id that is not a stream id", () => {
    const form = { ...emptyTrimForm(), strategy: "minid" as const };
    expect(validate(form, t)).toBe("board.topics.redis.trim.idRequired");
    for (const minId of ["yesterday", "-1", "1756454646018-", "1756454646018-0-0"]) {
      expect(validate({ ...form, minId }, t), minId).toBe("board.topics.redis.trim.idInvalid");
    }
  });

  // Redis accepts the milliseconds on their own and fills in the sequence, and
  // it is what someone pasting from a log actually has.
  it("accepts an id with or without a sequence", () => {
    const form = { ...emptyTrimForm(), strategy: "minid" as const };
    expect(validate({ ...form, minId: "1756454646018" }, t)).toBeNull();
    expect(validate({ ...form, minId: "1756454646018-0" }, t)).toBeNull();
  });

  /*
   * The field the strategy does not use must not travel. A stale id left in
   * the form after switching back to a length would otherwise be sent with a
   * maxlen request, and the server would be given two bounds.
   */
  it("sends only the bound the chosen strategy names", () => {
    const withBoth = { ...emptyTrimForm(), maxLen: "500", minId: "1756454646018-0" };

    const byLength = toRequest("orders:events", withBoth);
    expect(byLength).toEqual({
      stream: "orders:events",
      strategy: "maxlen",
      maxLen: 500,
      minId: "",
      approx: true,
    });

    const byPosition = toRequest("orders:events", { ...withBoth, strategy: "minid" });
    expect(byPosition.maxLen).toBe(0);
    expect(byPosition.minId).toBe("1756454646018-0");
  });

  it("trims the whitespace around what was typed", () => {
    expect(toRequest("s", { ...emptyTrimForm(), maxLen: "  500  " }).maxLen).toBe(500);
    expect(
      toRequest("s", { ...emptyTrimForm(), strategy: "minid", minId: "  1-0  " }).minId,
    ).toBe("1-0");
  });

  it("carries the approximate flag as the form set it", () => {
    expect(toRequest("s", { ...emptyTrimForm(), maxLen: "1", approx: false }).approx).toBe(false);
  });
});
