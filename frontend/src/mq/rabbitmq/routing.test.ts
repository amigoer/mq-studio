import { describe, expect, it } from "vitest";
import type { Binding } from "@bindings/model/models";
import { bindingKey, bindingsBySource, bindsExchange, routesOnKey } from "./routing";

const binding = (over: Partial<Binding>): Binding =>
  ({
    id: 1,
    namespace: "/",
    source: "ex.order",
    destination: "order.q",
    destinationKind: "queue",
    routingKey: "order.created",
    arguments: {},
    ...over,
  }) as Binding;

describe("RabbitMQ bindings", () => {
  /*
   * A binding has no name. The same exchange can bind to the same queue twice
   * with different routing keys, and a headers exchange binds with no key at
   * all and tells its bindings apart by arguments alone - so the identity has
   * to include all of it or two rows collapse into one.
   */
  it("identifies a binding by everything that distinguishes it", () => {
    const first = binding({ routingKey: "order.created" });
    const second = binding({ routingKey: "order.updated" });
    expect(bindingKey(first)).not.toBe(bindingKey(second));

    const headersA = binding({ routingKey: "", arguments: { "x-match": "all", kind: "a" } });
    const headersB = binding({ routingKey: "", arguments: { "x-match": "all", kind: "b" } });
    expect(bindingKey(headersA)).not.toBe(bindingKey(headersB));
  });

  it("tells a queue target from an exchange target", () => {
    expect(bindsExchange(binding({ destinationKind: "exchange" }))).toBe(true);
    expect(bindsExchange(binding({ destinationKind: "queue" }))).toBe(false);
  });

  /*
   * The board renders "no routing key" rather than an empty cell, because a
   * fanout genuinely has none and a blank leaves the reader guessing whether
   * the value is missing or absent.
   */
  it("reports whether a binding routes on its key at all", () => {
    expect(routesOnKey(binding({ routingKey: "order.created" }))).toBe(true);
    expect(routesOnKey(binding({ routingKey: "" }))).toBe(false);
  });

  it("groups bindings by the exchange they leave", () => {
    const grouped = bindingsBySource([
      binding({ source: "ex.order", destination: "a.q" }),
      binding({ source: "ex.order", destination: "b.q" }),
      binding({ source: "ex.audit", destination: "c.q" }),
    ]);
    expect(grouped.get("ex.order")).toHaveLength(2);
    expect(grouped.get("ex.audit")).toHaveLength(1);
    // An exchange with nothing bound is absent rather than an empty array, so
    // the caller decides what "nothing bound" should read as.
    expect(grouped.get("ex.unknown")).toBeUndefined();
  });
});
