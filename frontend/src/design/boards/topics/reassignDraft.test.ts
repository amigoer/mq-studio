import { describe, expect, it } from "vitest";
import {
  emptyReassignDraft,
  isUnchanged,
  parseBrokerList,
  validateReassignDraft,
} from "./reassignDraft";

const CLUSTER = [1, 2, 3];

describe("reading the broker list", () => {
  it("takes a comma-separated list in the order it was typed", () => {
    expect(parseBrokerList("3, 1, 2")).toEqual([3, 1, 2]);
    expect(parseBrokerList("2,1")).toEqual([2, 1]);
  });

  it("refuses anything that is not a list of ids", () => {
    expect(parseBrokerList("")).toBeNull();
    expect(parseBrokerList("  ")).toBeNull();
    expect(parseBrokerList("1, two")).toBeNull();
    expect(parseBrokerList("-1")).toBeNull();
  });
});

/*
 * Kafka accepts a plan naming a broker that does not exist: the copy never
 * starts and the move sits in flight until somebody cancels it. Refusing it
 * here is the difference between a form error and an afternoon.
 */
describe("validating a plan", () => {
  it("accepts a plan the cluster can carry out", () => {
    expect(validateReassignDraft({ brokers: "1, 2" }, CLUSTER)).toBeNull();
  });

  it("refuses a broker the cluster does not have", () => {
    expect(validateReassignDraft({ brokers: "1, 9" }, CLUSTER)).toBe("unknownBroker");
  });

  it("refuses one broker named twice", () => {
    expect(validateReassignDraft({ brokers: "1, 1" }, CLUSTER)).toBe("duplicate");
  });

  it("refuses more replicas than there are brokers", () => {
    expect(validateReassignDraft({ brokers: "1, 2, 3, 1" }, CLUSTER)).toBe("duplicate");
    expect(validateReassignDraft({ brokers: "1,2,3" }, [1, 2])).toBe("unknownBroker");
  });

  it("refuses an empty plan", () => {
    expect(validateReassignDraft({ brokers: "" }, CLUSTER)).toBe("brokersRequired");
  });
});

/*
 * The order is load-bearing: the first broker becomes the preferred leader, so
 * the same brokers in a different order is a different plan and must not be
 * treated as a no-op.
 */
describe("recognising a plan that changes nothing", () => {
  it("sees the placement the partition already has", () => {
    expect(isUnchanged({ brokers: "1, 2, 3" }, [1, 2, 3])).toBe(true);
  });

  it("does not see a reorder as unchanged", () => {
    expect(isUnchanged({ brokers: "3, 1, 2" }, [1, 2, 3])).toBe(false);
  });

  it("does not see a different length as unchanged", () => {
    expect(isUnchanged({ brokers: "1, 2" }, [1, 2, 3])).toBe(false);
  });
});

it("opens on the placement the partition already has", () => {
  expect(emptyReassignDraft([2, 3, 1]).brokers).toBe("2, 3, 1");
  expect(emptyReassignDraft().brokers).toBe("");
});
