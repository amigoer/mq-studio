import { describe, expect, it } from "vitest";
import { emptyClaimForm, minIdleMsOf, validate } from "./ClaimDialog";

const t = (key: string) => key;

/**
 * The minimum idle time is the whole safety of a claim. Without it the entries
 * move out from under a consumer that is simply busy, and both then believe
 * they own the same entry - which is the one way this page can make a working
 * system worse.
 */
describe("the claim a pending entry moves under", () => {
  it("defaults to a minute rather than to no guard at all", () => {
    const form = emptyClaimForm();
    expect(form.minIdleMinutes).toBe("1");
    expect(minIdleMsOf(form)).toBe(60_000);
  });

  it("needs the consumer to move the entries to", () => {
    expect(validate(emptyClaimForm(), t)).toBe("board.dlq.redis.claim.consumerRequired");
    expect(validate({ ...emptyClaimForm(), consumer: "   " }, t)).toBe(
      "board.dlq.redis.claim.consumerRequired",
    );
    expect(validate({ ...emptyClaimForm(), consumer: "worker-3" }, t)).toBeNull();
  });

  /*
   * Zero is a real answer, not a blank one: it moves the entries whatever
   * their idle time, which is right when the consumer is known to be gone. A
   * form that could not express it would push people to guess a number.
   */
  it("accepts zero as a deliberate absence of a guard", () => {
    const form = { ...emptyClaimForm(), consumer: "worker-3", minIdleMinutes: "0" };
    expect(minIdleMsOf(form)).toBe(0);
    expect(validate(form, t)).toBeNull();
  });

  it("converts minutes to the milliseconds the driver takes", () => {
    expect(minIdleMsOf({ ...emptyClaimForm(), minIdleMinutes: "5" })).toBe(300_000);
    expect(minIdleMsOf({ ...emptyClaimForm(), minIdleMinutes: " 60 " })).toBe(3_600_000);
  });

  it("refuses a threshold that is not a whole number of minutes", () => {
    const form = { ...emptyClaimForm(), consumer: "worker-3" };
    for (const minIdleMinutes of ["", "  ", "-1", "1.5", "soon", "1e2"]) {
      expect(minIdleMsOf({ ...form, minIdleMinutes }), minIdleMinutes).toBeNull();
      expect(validate({ ...form, minIdleMinutes }, t), minIdleMinutes).toBe(
        "board.dlq.redis.claim.idleInvalid",
      );
    }
  });
});
