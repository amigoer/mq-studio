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
