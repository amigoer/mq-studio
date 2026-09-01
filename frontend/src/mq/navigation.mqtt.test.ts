import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import { PROTOCOLS } from "@/design/data/protocols";
import type { CapabilityState } from "./capabilities";

/**
 * The sidebar a real MQTT connection draws.
 *
 * MQTT is the family this derivation was written for. Every other driver
 * answers most of the canonical pages; this one answers three of them and has
 * two of its own, and which of those it can serve is not knowable until it has
 * connected - the $SYS tree and the vendor management API are both optional
 * and both probed.
 *
 * The list below is what `capabilities()` in internal/driver/mqtt/conn.go
 * declares. A Go test asserts the driver still declares exactly this, so the
 * two halves cannot drift apart without one of them failing.
 */
const MQTT_CAPABILITIES: Capability[] = [
  Capability.CapDestinationList,
  Capability.CapPublish,
  Capability.CapLiveStream,
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapClientInspect,
  Capability.CapClientClose,
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

/** Every page the MQTT sidebar is built from, in the order it draws them. */
const drawn = PROTOCOLS.mqtt.nav.flatMap((group) => group.items.map((item) => item.id));

describe("the sidebar an MQTT connection draws", () => {
  /*
   * The pages MQTT has no concept of, asserted twice: gone from the sidebar,
   * and with no capability declared that would bring them back. Either alone
   * would let one return by the other route.
   *
   * Consumers is the one worth naming. MQTT has subscriptions and they are not
   * consumer groups: there is no offset, no lag and no membership, and the
   * page would have nothing but empty columns.
   */
  it("draws none of the pages MQTT has no concept of", () => {
    for (const absent of ["consumers", "messages", "dlq", "acl", "exchanges"]) {
      expect(drawn).not.toContain(absent);
    }

    const nav = navAvailability(state(MQTT_CAPABILITIES), true);
    for (const absent of ["consumers", "messages", "dlq", "acl"]) {
      expect(nav.visible(absent)).toBe(false);
    }
  });

  // A page reachable with nothing declared is a page nothing gates - which for
  // MQTT would mean drawing the clients board against a Mosquitto that has no
  // way to answer it.
  it("gates every browse and ops page on a capability", () => {
    const nav = navAvailability(state([]), true);
    const ungated = drawn.filter((id) => id !== "overview" && nav.visible(id));

    expect(ungated).toEqual([]);
  });

  it("reaches every page on a broker that answers all three tiers", () => {
    const nav = navAvailability(state(MQTT_CAPABILITIES), true);
    const reachable = drawn.filter((id) => nav.visible(id) && !nav.disabled(id));

    expect(reachable).toEqual([
      "overview",
      "topics",
      "subscribe",
      "producer",
      "clients",
      "cluster",
      "alerts",
    ]);
  });

  /*
   * A plain Mosquitto: the protocol tier and the $SYS tree, and no management
   * API at all. This is the deployment the degraded state was built for - the
   * clients page cannot be answered, and the difference between saying so and
   * dropping the entry is the difference between a broker that has no such
   * feature and an app that lost a page.
   */
  it("keeps the clients page drawn and explains it on a broker with no management api", () => {
    const nav = navAvailability(
      state(
        [
          Capability.CapDestinationList,
          Capability.CapPublish,
          Capability.CapLiveStream,
          Capability.CapClusterTopology,
          Capability.CapClusterMetrics,
        ],
        { [Capability.CapClientInspect]: "mq.mqtt.degraded.managementAbsent" },
      ),
      true,
    );

    expect(nav.visible("clients")).toBe(true);
    expect(nav.disabled("clients")).toBe(true);
    expect(nav.reason("clients")).toBe("mq.mqtt.degraded.managementAbsent");

    // Everything the protocol itself answers is still reachable.
    const reachable = drawn.filter((id) => nav.visible(id) && !nav.disabled(id));
    expect(reachable).toEqual(["overview", "topics", "subscribe", "producer", "cluster", "alerts"]);
  });

  /*
   * A default EMQX: the management API answers and the $SYS subscription is
   * refused by its own authorisation. The cluster pages survive that, because
   * the driver reads them from the API instead - so this asserts the case the
   * tiers were built to cover rather than a hypothetical one.
   */
  it("keeps the cluster pages on a broker that refuses $SYS but has an api", () => {
    const nav = navAvailability(state(MQTT_CAPABILITIES), true);

    expect(nav.disabled("cluster")).toBe(false);
    expect(nav.disabled("clients")).toBe(false);
  });

  // Being offline must not empty the sidebar. Every board draws its own "not
  // connected" state, and an outage is when moving between pages is most worth
  // having.
  it("draws every page while the connection is still unknown", () => {
    const nav = navAvailability(state([]), false);

    for (const id of drawn) {
      expect(nav.visible(id)).toBe(true);
      expect(nav.disabled(id)).toBe(false);
    }
  });
});
