import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import { PROTOCOLS } from "@/design/data/protocols";
import type { CapabilityState } from "./capabilities";

/**
 * The sidebar a real Pulsar connection draws.
 *
 * The last thing between a working driver and a working app: every page is
 * wired, and the one that decides whether you can reach it is this derivation.
 * A capability dropped on the Go side, or a `requires` entry naming the wrong
 * one, takes a whole finished page out of the app and nothing else notices.
 *
 * The list below is what `capabilities()` in internal/driver/pulsar/conn.go
 * declares. A Go test asserts the driver still declares exactly this, so the
 * two halves cannot drift apart without one of them failing. It starts empty
 * and grows one entry per commit, as each port arrives.
 */
const PULSAR_CAPABILITIES: Capability[] = [
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapNodeConfig,
  Capability.CapClusterHealth,
  Capability.CapNamespaceList,
  Capability.CapNamespaceAdmin,
  Capability.CapNamespaceLimits,
];

function state(
  supported: Capability[],
  degraded: Partial<Record<Capability, string>> = {},
): CapabilityState {
  return {
    has: (capability) => supported.includes(capability),
    degradedReason: (capability) => degraded[capability],
    caveat: () => undefined,
    loading: false,
  };
}

/** Every page the Pulsar sidebar is built from, in the order it draws them. */
const drawn = PROTOCOLS.pulsar.nav.flatMap((group) => group.items.map((item) => item.id));

describe("the sidebar a Pulsar connection draws", () => {
  // Capability gating hides a page the family has no concept of, so a page
  // reachable with nothing declared is a page nothing gates.
  it("gates every browse and ops page on a capability", () => {
    const nav = navAvailability(state([]), true);
    const ungated = drawn.filter((id) => id !== "overview" && nav.visible(id));

    expect(ungated).toEqual([]);
  });

  /*
   * The pages the driver can serve today.
   *
   * The list grows one entry per commit, and it growing by accident is exactly
   * what it is here to catch: a page that appears before it can read anything
   * is a sidebar entry that opens a board with nothing behind it.
   *
   * Alerts is here because CapClusterMetrics unlocks it, and Pulsar derives no
   * alerts yet. That is deliberate rather than an oversight - RULES_BY_KIND
   * gives the family an empty rule list so it cannot fall through to
   * RocketMQ's, which would draw an empty page that looks like a healthy
   * cluster instead of an unwritten one.
   */
  it("reaches the pages the driver declares capabilities for", () => {
    const nav = navAvailability(state(PULSAR_CAPABILITIES), true);
    const reachable = drawn.filter((id) => nav.visible(id) && !nav.disabled(id));

    expect(reachable).toEqual(["overview", "vhosts", "cluster", "alerts"]);
  });

  /*
   * A Pulsar dead-letter queue is an ordinary topic the client library names
   * by convention, so the page is answered by walking the namespace rather
   * than by asking the broker for a group's dead letters.
   *
   * Two assertions rather than one: the entry is in the sidebar because the
   * design has it, and only the topology capability may bring it back. Without
   * the second, declaring CapDLQ would light the page up through a port this
   * family has no way to implement.
   */
  it("reaches its dead-letter page through the topology capability", () => {
    expect(drawn).toContain("dlq");

    const byTopology = navAvailability(state([Capability.CapDeadLetterTopology]), true);
    expect(byTopology.visible("dlq")).toBe(true);
  });

  // A degraded capability keeps its page in the sidebar and says why, which is
  // the whole reason the middle state exists: a cluster that rejects a token
  // should explain itself, not quietly lose pages.
  it("keeps a degraded page drawn and gives its reason", () => {
    const nav = navAvailability(
      state([], { [Capability.CapClusterTopology]: "mq.pulsar.degraded.credentials" }),
      true,
    );

    expect(nav.visible("cluster")).toBe(true);
    expect(nav.disabled("cluster")).toBe(true);
    expect(nav.reason("cluster")).toBe("mq.pulsar.degraded.credentials");
  });
});
