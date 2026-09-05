import { describe, expect, it } from "vitest";
import { scopeOptions } from "./scopeOptions";

/*
 * What the switcher's popover offers for a query.
 *
 * The case that matters is a name the cluster has never carried: a RocketMQ
 * namespace is a prefix rather than an object, so the one you are about to
 * create the first topic in is invisible to the listing and still perfectly
 * usable. It has to stay reachable, and it must not be offered twice.
 */
const scope = (name: string) => ({ name, destinations: 0, subscriptions: 0 });

describe("what the popover offers", () => {
  it("offers a typed name the cluster has never carried", () => {
    const options = scopeOptions([scope("orders"), scope("audit")], "billing");
    expect(options.matched).toHaveLength(0);
    expect(options.typed).toBe("billing");
  });

  // Otherwise the same namespace appears twice, once as itself and once as
  // "switch to ...", which reads as two different destinations.
  it("does not offer a typed name the listing already holds", () => {
    const options = scopeOptions([scope("orders"), scope("audit")], "orders");
    expect(options.matched.map((entry) => entry.name)).toEqual(["orders"]);
    expect(options.typed).toBe("");
  });

  it("keeps a partial query as both a filter and an offer", () => {
    const options = scopeOptions([scope("orders"), scope("audit")], "ord");
    expect(options.matched.map((entry) => entry.name)).toEqual(["orders"]);
    expect(options.typed).toBe("ord");
  });

  it("offers nothing extra for an empty query", () => {
    const options = scopeOptions([scope("orders")], "   ");
    expect(options.matched.map((entry) => entry.name)).toEqual(["orders"]);
    expect(options.typed).toBe("");
  });
});
