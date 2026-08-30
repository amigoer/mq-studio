import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import type { CapabilityState } from "./capabilities";

/**
 * The three states have to stay distinguishable: drawn, drawn-but-blocked, and
 * not drawn at all. Collapsing the middle one into the last is what makes a
 * deliberately limited endpoint read as a bug.
 */
function state(
  supported: Capability[],
  degraded: Partial<Record<Capability, string>> = {},
  loading = false,
): CapabilityState {
  return {
    has: (capability) => supported.includes(capability),
    degradedReason: (capability) => degraded[capability],
    caveat: () => undefined,
    loading,
  };
}

const everything = [
  Capability.CapDestinationList,
  Capability.CapSubscriptionList,
  Capability.CapMessageQuery,
  Capability.CapPublish,
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapAccessControl,
];

describe("navAvailability", () => {
  it("draws every page an endpoint reports", () => {
    const nav = navAvailability(state(everything), true);
    for (const id of ["topics", "consumers", "messages", "producer", "cluster", "alerts", "acl"]) {
      expect(nav.visible(id), id).toBe(true);
      expect(nav.disabled(id), id).toBe(false);
    }
  });

  it("hides a page whose capability the endpoint never mentions", () => {
    const nav = navAvailability(state([Capability.CapDestinationList]), true);
    expect(nav.visible("topics")).toBe(true);
    expect(nav.visible("acl")).toBe(false);
  });

  it("draws a degraded page disabled, carrying the reason", () => {
    const nav = navAvailability(
      state([Capability.CapDestinationList], { [Capability.CapAccessControl]: "no admin plane" }),
      true,
    );
    expect(nav.visible("acl")).toBe(true);
    expect(nav.disabled("acl")).toBe(true);
    expect(nav.reason("acl")).toBe("no admin plane");
  });

  it("disables nothing while offline, because each board says so itself", () => {
    const nav = navAvailability(state([]), false);
    for (const id of ["topics", "consumers", "cluster", "acl"]) {
      expect(nav.visible(id), id).toBe(true);
      expect(nav.disabled(id), id).toBe(false);
    }
  });

  it("waits for the endpoint's answer rather than hiding on an empty one", () => {
    const nav = navAvailability(state([], {}, true), true);
    expect(nav.visible("acl")).toBe(true);
    expect(nav.disabled("acl")).toBe(false);
  });

  it("leaves the shell's own entries alone", () => {
    const nav = navAvailability(state([]), true);
    for (const id of ["home", "connections", "settings", "github"]) {
      expect(nav.visible(id), id).toBe(true);
      expect(nav.disabled(id), id).toBe(false);
    }
  });
});

/**
 * Two families, two shapes. RabbitMQ has exchanges and no consumer groups to
 * reset; RocketMQ has neither exchanges nor a routing page. The sidebar is
 * what makes that visible, so these pin the entries each one does and does not
 * draw rather than trusting the nav constant.
 */
describe("navAvailability across families", () => {
  it("draws the exchanges entry only where routing exists", () => {
    const rabbit = navAvailability(state([Capability.CapRouting]), true);
    expect(rabbit.visible("exchanges")).toBe(true);

    const rocket = navAvailability(state([Capability.CapDestinationList]), true);
    expect(rocket.visible("exchanges")).toBe(false);
  });

  // Dead letters are a queue with a policy pointing at it in RabbitMQ and a
  // built-in retry topic in RocketMQ. A family reporting neither must not draw
  // an entry that lands on an empty page.
  it("draws the dead-letter entry only where the driver reports one", () => {
    expect(navAvailability(state([Capability.CapDLQ]), true).visible("dlq")).toBe(true);
    expect(navAvailability(state([Capability.CapMessageQuery]), true).visible("dlq")).toBe(false);
  });

  // RabbitMQ has no credential-based ACL of the shape AccessAdmin describes,
  // so the driver declares nothing and the entry must not appear.
  it("hides the access-control entry for a family that declares none", () => {
    const rabbit = navAvailability(
      state([Capability.CapDestinationList, Capability.CapRouting, Capability.CapPublish]),
      true,
    );
    expect(rabbit.visible("acl")).toBe(false);
  });
});
