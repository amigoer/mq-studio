import { describe, expect, it } from "vitest";
import { emptyPositionForm, toPosition, validate } from "./PositionDialog";

const t = (key: string) => key;

/**
 * Repositioning a group changes what every consumer in it sees next, and none
 * of it is reversible except by repositioning again. The two special places
 * have to come out as the letters Redis expects, and an id has to be an id.
 */
describe("the position a reposition submits", () => {
  it("spells the beginning and the end the way Redis does", () => {
    expect(toPosition({ ...emptyPositionForm(), choice: "beginning" })).toBe("0");
    expect(toPosition({ ...emptyPositionForm(), choice: "end" })).toBe("$");
  });

  it("defaults to the beginning", () => {
    // The recoverable direction: replaying is work, skipping is loss. A group
    // moved to the end abandons everything it had not read.
    expect(emptyPositionForm().choice).toBe("beginning");
  });

  it("needs no id for the two special places", () => {
    expect(validate({ ...emptyPositionForm(), choice: "beginning" }, t)).toBeNull();
    expect(validate({ ...emptyPositionForm(), choice: "end" }, t)).toBeNull();
    // Even with one typed and then abandoned: the choice decides what travels.
    expect(
      toPosition({ choice: "end", entryId: "1756454646018-0" }),
    ).toBe("$");
  });

  it("needs an id for an explicit entry, and refuses what is not one", () => {
    const form = { ...emptyPositionForm(), choice: "entry" as const };
    expect(validate(form, t)).toBe("board.consumers.redis.position.idRequired");
    for (const entryId of ["yesterday", "-1", "1756454646018-", "1-2-3", "0x10"]) {
      expect(validate({ ...form, entryId }, t), entryId).toBe(
        "board.consumers.redis.position.idInvalid",
      );
    }
  });

  // Redis accepts the milliseconds on their own and fills in the sequence, and
  // it is what someone pasting from a log actually has.
  it("accepts an id with or without a sequence, trimmed", () => {
    const form = { ...emptyPositionForm(), choice: "entry" as const };
    expect(validate({ ...form, entryId: "1756454646018" }, t)).toBeNull();
    expect(validate({ ...form, entryId: "  1756454646018-4  " }, t)).toBeNull();
    expect(toPosition({ ...form, entryId: "  1756454646018-4  " })).toBe("1756454646018-4");
  });
});
