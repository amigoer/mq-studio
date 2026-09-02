import { describe, expect, it } from "vitest";
import { emptyEntryDraft, toDraft, usableFields, validate } from "./entryDraft";

const t = (key: string) => key;
const form = (over: Partial<ReturnType<typeof emptyEntryDraft>> = {}) => ({
  ...emptyEntryDraft("orders:events"),
  fields: [{ name: "order", value: "A-1001" }],
  ...over,
});

describe("the entry a send console writes", () => {
  it("starts with one empty field and a single copy", () => {
    const empty = emptyEntryDraft("orders:events");
    expect(empty.fields).toHaveLength(1);
    expect(empty.count).toBe("1");
    // Empty, not "*": the field being blank is what says "let the server
    // assign one", and prefilling a placeholder would look like a value.
    expect(empty.id).toBe("");
  });

  /*
   * An abandoned row is dropped rather than refused: someone who clicked "add
   * field" and changed their mind should not have to tidy up before sending.
   */
  it("drops a row with no name and keeps the rest", () => {
    const draft = toDraft(
      form({
        fields: [
          { name: "order", value: "A-1001" },
          { name: "  ", value: "abandoned" },
          { name: "total", value: "42.50" },
        ],
      }),
    );
    expect(draft.fields).toEqual([
      { name: "order", value: "A-1001" },
      { name: "total", value: "42.50" },
    ]);
  });

  it("refuses an entry with nothing named at all", () => {
    // Redis will not store one, so the form says why rather than letting the
    // server answer with a wrong-number-of-arguments error.
    expect(validate(form({ fields: [{ name: "", value: "x" }] }), t)).toBe(
      "board.producer.redis.fieldRequired",
    );
    expect(usableFields(form({ fields: [{ name: " ", value: "x" }] }))).toEqual([]);
  });

  it("needs a stream", () => {
    expect(validate(form({ stream: "  " }), t)).toBe("board.producer.redis.streamRequired");
  });

  /*
   * Names are trimmed and values are not. A name with a space is a different
   * field and almost certainly a slip; whitespace inside a value may be
   * exactly what the producer meant to send.
   */
  it("trims the field names and leaves the values alone", () => {
    const draft = toDraft(form({ fields: [{ name: "  order  ", value: "  A-1001  " }] }));
    expect(draft.fields[0]).toEqual({ name: "order", value: "  A-1001  " });
  });

  it("sends no id when the field is blank, which lets the server assign one", () => {
    expect(toDraft(form()).id).toBe("");
    expect(validate(form(), t)).toBeNull();
  });

  it("refuses an id that is not an entry id", () => {
    for (const id of ["yesterday", "-1", "1756454646018-", "1-2-3"]) {
      expect(validate(form({ id }), t), id).toBe("board.producer.redis.idInvalid");
    }
    expect(validate(form({ id: "1756454646018" }), t)).toBeNull();
    expect(validate(form({ id: "1756454646018-0" }), t)).toBeNull();
  });

  /*
   * The combination that would half-succeed. Each copy needs its own id, so a
   * second one would fail having already written the first - refusing here
   * leaves the stream exactly as it was.
   */
  it("refuses an explicit id together with a count", () => {
    expect(validate(form({ id: "1756454646018-0", count: "3" }), t)).toBe(
      "board.producer.redis.idWithCount",
    );
    expect(validate(form({ id: "1756454646018-0", count: "1" }), t)).toBeNull();
  });

  it("refuses a count that is not a whole number of at least one", () => {
    for (const count of ["0", "-1", "1.5", "many", "1e4", "0x10"]) {
      expect(validate(form({ count }), t), count).toBe("board.producer.redis.countInvalid");
    }
    expect(validate(form({ count: "" }), t)).toBe("board.producer.redis.countRequired");
    expect(toDraft(form({ count: " 25 " })).count).toBe(25);
  });
});
