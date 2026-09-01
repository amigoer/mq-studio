import { describe, expect, it } from "vitest";
import { Namespace } from "@bindings/model/models";
import {
  LimitMaxProducersPerTopic,
  LimitMessageTTLSeconds,
  limit,
  limitCount,
  shortNameOf,
  tenantOf,
  validateName,
} from "./namespaces";

const t = (key: string) => key;

const namespace = (name: string, limits: Record<string, number> = {}): Namespace =>
  new Namespace({ name, limits });

/*
 * A limit nobody set and a limit set to zero are different facts.
 *
 * Pulsar makes every one of these nullable precisely because of this: no limit
 * is the broker's own setting deciding, and zero producers is a namespace
 * nothing can publish to. Reading an absent limit as 0 would tell an operator
 * their namespace is closed for writing.
 */
describe("a namespace limit", () => {
  it("reads an unset limit as null rather than zero", () => {
    expect(limit(namespace("public/orders"), LimitMessageTTLSeconds)).toBeNull();
  });

  it("keeps an explicit zero", () => {
    const capped = namespace("public/orders", { [LimitMaxProducersPerTopic]: 0 });
    expect(limit(capped, LimitMaxProducersPerTopic)).toBe(0);
  });

  it("counts only the limits that are set", () => {
    expect(limitCount(namespace("public/orders"))).toBe(0);
    expect(
      limitCount(
        namespace("public/orders", {
          [LimitMessageTTLSeconds]: 3600,
          [LimitMaxProducersPerTopic]: 0,
        }),
      ),
    ).toBe(2);
  });

  // A key the driver does not write is not a limit of zero either.
  it("ignores a key this family does not carry", () => {
    expect(limit(namespace("public/orders", { maxQueues: 10 }), "maxQueues")).toBe(10);
    expect(limitCount(namespace("public/orders", { maxQueues: 10 }))).toBe(0);
  });
});

/*
 * A Pulsar namespace name is two parts and the separator is meaningful.
 *
 * Splitting on the last slash would move part of a name into the tenant for
 * anything unusual, so the split is taken from the front - the tenant is
 * always exactly the first segment.
 */
describe("the two halves of a namespace name", () => {
  it("splits tenant from namespace", () => {
    expect(tenantOf(namespace("public/orders"))).toBe("public");
    expect(shortNameOf(namespace("public/orders"))).toBe("orders");
  });

  it("leaves an unqualified name as its own short name", () => {
    expect(shortNameOf(namespace("orders"))).toBe("orders");
  });
});

/*
 * The form catches what Pulsar would refuse, so the message names the field.
 *
 * A 412 from the broker arrives with Pulsar's own wording and no indication of
 * which input produced it.
 */
describe("what the namespace form refuses", () => {
  it("needs a name", () => {
    expect(validateName("", t)).toBe("board.vhosts.pulsar.nameRequired");
    expect(validateName("   ", t)).toBe("board.vhosts.pulsar.nameRequired");
  });

  // The slash is what separates a namespace from its tenant, and the tenant
  // comes from the connection rather than from this field.
  it("refuses a slash", () => {
    expect(validateName("shop/orders", t)).toBe("board.vhosts.pulsar.nameSlash");
  });

  it("refuses characters Pulsar would reject", () => {
    expect(validateName("order events", t)).toBe("board.vhosts.pulsar.nameInvalid");
    expect(validateName("orders!", t)).toBe("board.vhosts.pulsar.nameInvalid");
  });

  it("accepts the shapes Pulsar allows", () => {
    for (const name of ["orders", "order-events", "order_events", "orders.v2", "v2"]) {
      expect(validateName(name, t)).toBeNull();
    }
  });
});
