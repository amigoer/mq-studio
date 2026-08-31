import { describe, expect, it } from "vitest";
import { transactionAge, transactionOverdue } from "./cluster";

const NOW = 1_756_000_000_000;

describe("transactionAge", () => {
  it("reads in the unit that suits the age", () => {
    expect(transactionAge(NOW - 12_000, NOW)).toBe("12s");
    expect(transactionAge(NOW - 9 * 60_000, NOW)).toBe("9m");
    expect(transactionAge(NOW - (3 * 3600 + 25 * 60) * 1000, NOW)).toBe("3h 25m");
    expect(transactionAge(NOW - 50 * 3600 * 1000, NOW)).toBe("2d 2h");
  });

  // Unknown is not zero. A transaction that began this instant and one whose
  // start nobody reported must not read alike.
  it("says nothing when the coordinator reported no start time", () => {
    expect(transactionAge(-1, NOW)).toBe("—");
    expect(transactionAge(0, NOW)).not.toBe("—");
  });

  // The broker's clock and this machine's are different clocks.
  it("does not render skew as a negative age", () => {
    expect(transactionAge(NOW + 5_000, NOW)).toBe("—");
  });
});

describe("transactionOverdue", () => {
  it("marks a transaction the cluster should already have aborted", () => {
    expect(transactionOverdue(true, NOW - 90_000, 60_000, NOW)).toBe(true);
    expect(transactionOverdue(true, NOW - 30_000, 60_000, NOW)).toBe(false);
  });

  /*
   * A finished transaction is never overdue, however old.
   *
   * The cluster keeps one listed after it ends, so every completed
   * transaction on the page is older than its own timeout. Reading the clock
   * alone put a red "past timeout" badge on two transactions that had
   * finished cleanly - the panel's whole job is to point at the one that has
   * not, and it was pointing at the wrong ones.
   */
  it("says nothing about a transaction that has already finished", () => {
    expect(transactionOverdue(false, NOW - 90_000, 60_000, NOW)).toBe(false);
    expect(transactionOverdue(false, 1, 60_000, NOW)).toBe(false);
  });

  // Both halves are needed, so neither missing one may be guessed at: without
  // a start or without a timeout there is no deadline to have passed.
  it("claims nothing without both a start and a timeout", () => {
    expect(transactionOverdue(true, -1, 60_000, NOW)).toBe(false);
    expect(transactionOverdue(true, NOW - 90_000, 0, NOW)).toBe(false);
  });
});
