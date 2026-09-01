import { describe, expect, it } from "vitest";
import { ResetMode, emptyResetForm, toRequest } from "./ResetCursorDialogPulsar";

/*
 * The three modes reach three different endpoints, and getting one wrong is
 * silent.
 *
 * A skip that replayed hands a consumer a backlog somebody asked to discard,
 * and a replay that skipped throws away messages somebody asked to see again.
 * Neither comes back as an error, so this mapping is the only place it is
 * caught.
 */
describe("what a cursor reset sends", () => {
  it("replays everything with no timestamp and no force", () => {
    expect(toRequest({ ...emptyResetForm(), mode: ResetMode.Earliest })).toEqual({
      timestamp: 0,
      force: false,
    });
  });

  // Force is the flag the driver turns into ClearBacklog, which is genuinely a
  // different operation rather than a stronger reset.
  it("skips the backlog with force set", () => {
    expect(toRequest({ ...emptyResetForm(), mode: ResetMode.Skip })).toEqual({
      timestamp: 0,
      force: true,
    });
  });

  it("sends the chosen moment as epoch milliseconds", () => {
    const at = "2026-09-02T10:30";
    const request = toRequest({ mode: ResetMode.Timestamp, at });
    expect(request).toEqual({ timestamp: new Date(at).getTime(), force: false });
  });

  /*
   * A blank or unreadable time is refused rather than sent.
   *
   * new Date("") is Invalid Date and getTime() is NaN, which would cross the
   * bridge as a number and reach the broker as a cursor position nobody chose.
   */
  it("refuses a time it cannot read", () => {
    expect(toRequest({ mode: ResetMode.Timestamp, at: "" })).toEqual({
      error: "timeRequired",
    });
    expect(toRequest({ mode: ResetMode.Timestamp, at: "not a time" })).toEqual({
      error: "timeInvalid",
    });
  });

  it("opens on the least destructive option", () => {
    expect(emptyResetForm().mode).toBe(ResetMode.Earliest);
  });
});
