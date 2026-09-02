import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import { PROTOCOLS } from "@/design/data/protocols";
import type { CapabilityState } from "./capabilities";

/**
 * The sidebar a real NATS connection draws.
 *
 * NATS is the family with the most that can be missing. Four sources answer
 * these pages - the protocol, JetStream, the server's monitoring endpoint and
 * the system account - and each of the last three is optional in a way the
 * driver only discovers once it has connected. So the same cluster reached
 * with different credentials draws a different sidebar, and the entries that
 * disappear have to disappear for a reason the user can read.
 *
 * The list below is what `capabilities()` in internal/driver/nats/conn.go
 * declares. A Go test asserts the driver still declares exactly this, so the
 * two halves cannot drift apart without one of them failing. It grows one
 * entry at a time: a capability with no port behind it fails conformance, so
 * each arrives in the commit that implements it.
 */
const NATS_CAPABILITIES: Capability[] = [
  Capability.CapPublish,
  Capability.CapLiveStream,
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapNodeConfig,
  Capability.CapDestinationList,
  Capability.CapDestinationCreate,
  Capability.CapDestinationUpdate,
  Capability.CapDestinationDelete,
  Capability.CapPartitions,
  Capability.CapStreamTrim,
  Capability.CapSubscriptionList,
  Capability.CapSubscriptionCreate,
  Capability.CapSubscriptionDelete,
  Capability.CapSubscriptionLag,
  Capability.CapMessageQuery,
  Capability.CapMessageByID,
  Capability.CapMessageLiveTail,
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

/** Every page the NATS sidebar is built from, in the order it draws them. */
const drawn = PROTOCOLS.nats.nav.flatMap((group) => group.items.map((item) => item.id));

describe("the sidebar a NATS connection draws", () => {
  /*
   * The pages NATS has no concept of, asserted twice: absent from the sidebar,
   * and with no capability declared that would bring them back. Either alone
   * would let one return by the other route.
   *
   * Dead letters is the one worth naming. JetStream has a redelivery limit and
   * publishes an advisory when a consumer reaches it, but nothing is moved
   * anywhere - there is no queue of given-up-on messages to read, and a page
   * that drew one would be permanently empty.
   */
  it("draws none of the pages NATS has no concept of", () => {
    for (const absent of ["dlq", "exchanges", "policies", "definitions", "quotas", "replication"]) {
      expect(drawn).not.toContain(absent);
    }

    const nav = navAvailability(state(NATS_CAPABILITIES), true);
    for (const absent of ["dlq", "exchanges", "policies", "definitions", "quotas", "replication"]) {
      expect(nav.visible(absent), absent).toBe(false);
    }
  });

  /*
   * Every entry the sidebar draws has to be reachable from the capabilities
   * the driver declares. An entry drawn with nothing behind it opens onto a
   * page that fails when it asks for data, which reads as a broken app rather
   * than as a broker that cannot answer.
   */
  it("draws only entries the declared capabilities can reach", () => {
    const nav = navAvailability(state(NATS_CAPABILITIES), true);
    for (const page of drawn) {
      expect(nav.visible(page), page).toBe(true);
    }
  });

  /*
   * A tier that did not answer takes its pages out of the sidebar and says
   * why. This is the whole reason the driver reports six separate reasons
   * rather than one: the sidebar shows the reason it was handed, so a page
   * missing because the server has no JetStream and one missing because this
   * account was denied it read differently to whoever is looking.
   */
  it("explains a page a tier could not answer rather than hiding it", () => {
    // Degraded means gone from Supported, not listed in both: model.Capabilities
    // .WithDegraded drops it from one as it adds it to the other, precisely so
    // the UI never has to choose between drawing the control and explaining its
    // absence. A fixture that left it supported would test a state the driver
    // cannot produce.
    const withoutJetStream = NATS_CAPABILITIES.filter(
      (capability) => capability !== Capability.CapDestinationList,
    );
    const nav = navAvailability(
      state(withoutJetStream, {
        [Capability.CapDestinationList]: "mq.nats.degraded.jetstreamDisabled",
      }),
      true,
    );
    expect(nav.visible("topics")).toBe(true);
    expect(nav.disabled("topics")).toBe(true);
    expect(nav.reason("topics")).toBe("mq.nats.degraded.jetstreamDisabled");
  });
});
