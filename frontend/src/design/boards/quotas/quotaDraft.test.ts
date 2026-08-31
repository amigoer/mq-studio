import { describe, expect, it } from "vitest";
import type { ClientQuota } from "@bindings/model/models";
import {
  emptyQuotaDraft,
  entityCombinationIsValid,
  quotaLabel,
  quotaLimitKeys,
  toQuotaEntity,
  toQuotaLimits,
  validateQuotaDraft,
  type QuotaDraft,
} from "./quotaDraft";

const LIMITS = ["producer_byte_rate", "consumer_byte_rate"];

const draft = (over: Partial<QuotaDraft> = {}): QuotaDraft => ({
  ...emptyQuotaDraft(LIMITS),
  entity: [{ type: "user", name: "alice", isDefault: false }],
  limits: { producer_byte_rate: "1048576", consumer_byte_rate: "" },
  ...over,
});

describe("the quota entity", () => {
  it("needs a name unless it is the default", () => {
    expect(validateQuotaDraft(draft())).toBeNull();
    expect(validateQuotaDraft(draft({ entity: [{ type: "user", name: "", isDefault: false }] })))
      .toBe("nameRequired");
    expect(validateQuotaDraft(draft({ entity: [{ type: "user", name: "", isDefault: true }] })))
      .toBeNull();
  });

  it("refuses one dimension twice", () => {
    expect(
      validateQuotaDraft(
        draft({
          entity: [
            { type: "user", name: "alice", isDefault: false },
            { type: "user", name: "bob", isDefault: false },
          ],
        }),
      ),
    ).toBe("duplicateType");
  });

  /*
   * A user and a client id compose - "this application, run by this user" is a
   * real limit. An IP does not: it throttles connections before anybody has
   * authenticated, so there is no identity to combine it with, and Kafka
   * answers INVALID_REQUEST rather than explaining.
   */
  it("refuses an IP combined with an identity", () => {
    expect(
      entityCombinationIsValid([
        { type: "ip", name: "10.0.0.1", isDefault: false },
        { type: "user", name: "alice", isDefault: false },
      ]),
    ).toBe(false);
    expect(
      entityCombinationIsValid([
        { type: "user", name: "alice", isDefault: false },
        { type: "client-id", name: "importer", isDefault: false },
      ]),
    ).toBe(true);
    expect(entityCombinationIsValid([{ type: "ip", name: "10.0.0.1", isDefault: false }])).toBe(true);
  });
});

/*
 * Blank leaves a limit alone; zero is a real quota that throttles a client to
 * nothing. An operator who meant "no limit" and got zero would have stopped
 * the thing they were trying to unblock.
 */
describe("the limits", () => {
  it("needs at least one", () => {
    expect(
      validateQuotaDraft(draft({ limits: { producer_byte_rate: "", consumer_byte_rate: "" } })),
    ).toBe("limitRequired");
  });

  it("sends only the fields that were filled in", () => {
    expect(toQuotaLimits(draft())).toEqual({ producer_byte_rate: 1048576 });
  });

  it("sends a typed zero, because that is a real quota", () => {
    const set = toQuotaLimits(draft({ limits: { producer_byte_rate: "0", consumer_byte_rate: "" } }));
    expect(set).toEqual({ producer_byte_rate: 0 });
  });

  it("refuses a limit that is not a non-negative number", () => {
    expect(validateQuotaDraft(draft({ limits: { producer_byte_rate: "-1", consumer_byte_rate: "" } })))
      .toBe("limitInvalid");
    expect(validateQuotaDraft(draft({ limits: { producer_byte_rate: "lots", consumer_byte_rate: "" } })))
      .toBe("limitInvalid");
  });
});

describe("the submitted entity", () => {
  it("marks the default rather than sending an empty name", () => {
    const [entity] = toQuotaEntity(draft({ entity: [{ type: "client-id", name: "x", isDefault: true }] }));
    expect(entity).toMatchObject({ type: "client-id", default: true, name: "" });
  });

  it("trims a name that was typed", () => {
    const [entity] = toQuotaEntity(draft({ entity: [{ type: "user", name: "  alice  ", isDefault: false }] }));
    expect(entity).toMatchObject({ name: "alice", default: false });
  });
});

/*
 * The default and a client whose name happens to be empty are different rows
 * on the cluster, so they must not read the same on the page either.
 */
describe("how a quota reads", () => {
  const quota = (entity: unknown[], limits: Record<string, number> = {}) =>
    ({ entity, limits }) as unknown as ClientQuota;

  it("names the default rather than leaving it blank", () => {
    expect(quotaLabel(quota([{ type: "user", name: "", default: true }])))
      .toBe("user=<default>");
    expect(quotaLabel(quota([{ type: "user", name: "", default: false }])))
      .toBe("user=");
  });

  it("joins every dimension", () => {
    expect(
      quotaLabel(
        quota([
          { type: "user", name: "alice", default: false },
          { type: "client-id", name: "importer", default: false },
        ]),
      ),
    ).toBe("user=alice, client-id=importer");
  });

  it("lists the limit keys sorted, so a row does not reshuffle", () => {
    expect(quotaLimitKeys(quota([], { request_percentage: 1, consumer_byte_rate: 2 })))
      .toEqual(["consumer_byte_rate", "request_percentage"]);
  });
});
