import { describe, expect, it } from "vitest";
import { emptyGroupForm, validate } from "./GroupDialog";

const t = (key: string) => key;

/**
 * Declaring a group has one consequential decision and two required fields,
 * and none of the three has a safe server-side default.
 */
describe("the consumer group a create dialog declares", () => {
  it("defaults to the end of the stream", () => {
    // Both starts are consequential and in opposite directions. The end is the
    // one that cannot go wrong loudly: a group created there sees what arrives
    // next, where one created at the beginning replays the whole stream into
    // whatever attaches first.
    expect(emptyGroupForm("orders:events").start).toBe("$");
  });

  it("needs the stream as well as the name", () => {
    // A group name is unique only within its stream, so neither half alone
    // names anything the server could act on.
    expect(validate(emptyGroupForm(""), t)).toBe("board.consumers.redis.streamRequired");
    expect(validate(emptyGroupForm("orders:events"), t)).toBe(
      "board.consumers.redis.groupRequired",
    );
    expect(validate({ ...emptyGroupForm("orders:events"), group: "settle" }, t)).toBeNull();
  });

  it("treats a whitespace-only name as no name", () => {
    expect(validate({ ...emptyGroupForm("orders:events"), group: "   " }, t)).toBe(
      "board.consumers.redis.groupRequired",
    );
  });
});
