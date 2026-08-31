import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import { PROTOCOLS } from "@/design/data/protocols";
import type { CapabilityState } from "./capabilities";

/**
 * The sidebar a real Kafka connection draws.
 *
 * The last thing between a working driver and a working app: every page is
 * wired, and the one that decides whether you can reach it is this derivation.
 * A capability dropped on the Go side, or a `requires` entry naming the wrong
 * one, takes a whole finished page out of the app and nothing else notices.
 *
 * The list below is what `capabilities()` in internal/driver/kafka/conn.go
 * declares. A Go test asserts the driver still declares exactly this, so the
 * two halves cannot drift apart without one of them failing.
 */
const KAFKA_CAPABILITIES: Capability[] = [
  Capability.CapDestinationList,
  Capability.CapDestinationCreate,
  Capability.CapDestinationUpdate,
  Capability.CapDestinationDelete,
  Capability.CapPartitions,
  Capability.CapDestinationPurge,
  Capability.CapQueueRebalance,
  Capability.CapSubscriptionList,
  Capability.CapSubscriptionDelete,
  Capability.CapSubscriptionLag,
  Capability.CapOffsetReset,
  Capability.CapOffsetClone,
  Capability.CapQueueOffset,
  Capability.CapMessageQuery,
  Capability.CapMessageByID,
  Capability.CapMessageLiveTail,
  Capability.CapPublish,
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapNodeConfig,
  Capability.CapLogDirs,
  Capability.CapAccessDirectory,
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

/** Every page the Kafka sidebar is built from, in the order it draws them. */
const drawn = PROTOCOLS.kafka.nav.flatMap((group) => group.items.map((item) => item.id));

describe("the sidebar a Kafka connection draws", () => {
  /*
   * Kafka has no broker-side dead-letter queue. The .DLT and -dlq suffixes are
   * conventions belonging to Spring Kafka and Kafka Connect, and the board that
   * used to be here decoded Spring's own exception headers - a framework's
   * private arrangement presented as something Kafka does.
   *
   * Two assertions rather than one: the entry is gone from the sidebar, and no
   * capability that would bring it back is declared. Either alone would let it
   * return by the other route.
   */
  it("has no dead-letter entry", () => {
    expect(drawn).not.toContain("dlq");

    const nav = navAvailability(state(KAFKA_CAPABILITIES), true);
    expect(nav.visible("dlq")).toBe(false);
  });

  // Capability gating hides a page the family has no concept of, so a page
  // reachable with nothing declared is a page nothing gates.
  it("gates every browse and ops page on a capability", () => {
    const nav = navAvailability(state([]), true);
    const ungated = drawn.filter((id) => id !== "overview" && nav.visible(id));

    expect(ungated).toEqual([]);
  });

  // The pages the driver can serve today. This list grows one entry per
  // commit, and it growing by accident is exactly what it is here to catch.
  it("reaches the pages the driver declares capabilities for", () => {
    const nav = navAvailability(state(KAFKA_CAPABILITIES), true);
    const reachable = drawn.filter((id) => nav.visible(id) && !nav.disabled(id));

    expect(reachable).toEqual([
      "overview",
      "topics",
      "consumers",
      "messages",
      "producer",
      "cluster",
      "alerts",
      "acl",
    ]);
  });

  // A degraded capability keeps its page in the sidebar and says why, which is
  // the whole reason the middle state exists: a cluster that refuses a
  // credential should explain itself, not quietly lose pages.
  it("keeps a degraded page drawn and gives its reason", () => {
    const nav = navAvailability(
      state([], { [Capability.CapClusterTopology]: "mq.kafka.degraded.credentials" }),
      true,
    );

    expect(nav.visible("cluster")).toBe(true);
    expect(nav.disabled("cluster")).toBe(true);
    expect(nav.reason("cluster")).toBe("mq.kafka.degraded.credentials");
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
