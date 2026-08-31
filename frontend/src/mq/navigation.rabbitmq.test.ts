import { describe, expect, it } from "vitest";
import { Capability } from "@bindings/model/models";
import { navAvailability } from "./navigation";
import { PROTOCOLS } from "@/design/data/protocols";
import type { CapabilityState } from "./capabilities";

/**
 * The sidebar a real RabbitMQ connection draws.
 *
 * The last thing between a working driver and a working app: every page is
 * wired, and the one that decides whether you can reach it is this derivation.
 * A capability dropped on the Go side, or a `requires` entry naming the wrong
 * one, takes a whole finished page out of the app and nothing else notices.
 *
 * The list below is what `capabilities()` in internal/driver/rabbitmq/conn.go
 * declares. A Go test asserts the driver still declares exactly this, so the
 * two halves cannot drift apart without one of them failing.
 */
const RABBITMQ_CAPABILITIES: Capability[] = [
  Capability.CapDestinationList,
  Capability.CapDestinationCreate,
  Capability.CapDestinationDelete,
  Capability.CapDestinationPurge,
  Capability.CapDestinationMove,
  Capability.CapQueueRebalance,
  Capability.CapSubscriptionList,
  Capability.CapSubscriptionLag,
  Capability.CapMessageQuery,
  Capability.CapDeadLetterTopology,
  Capability.CapPublish,
  Capability.CapPublishRich,
  Capability.CapClusterTopology,
  Capability.CapClusterMetrics,
  Capability.CapClusterCensus,
  Capability.CapClientInspect,
  Capability.CapClientClose,
  Capability.CapClusterHealth,
  Capability.CapNamespaceList,
  Capability.CapNamespaceAdmin,
  Capability.CapNamespaceLimits,
  Capability.CapIdentityList,
  Capability.CapIdentityAdmin,
  Capability.CapIdentityPermissions,
  Capability.CapPolicyList,
  Capability.CapPolicyAdmin,
  Capability.CapParameterAdmin,
  Capability.CapDefinitionsExport,
  Capability.CapDefinitionsImport,
  Capability.CapReplication,
  Capability.CapStreamClients,
  Capability.CapRouting,
  Capability.CapRoutingAdmin,
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

/** Every page the RabbitMQ sidebar is built from, in the order it draws them. */
const drawn = PROTOCOLS.rabbitmq.nav.flatMap((group) => group.items.map((item) => item.id));

describe("the sidebar a RabbitMQ connection draws", () => {
  it("reaches every page the driver was built for", () => {
    const nav = navAvailability(state(RABBITMQ_CAPABILITIES), true);
    const reachable = drawn.filter((id) => nav.visible(id) && !nav.disabled(id));

    expect(reachable).toEqual([
      "overview",
      "topics",
      "exchanges",
      "consumers",
      "messages",
      "dlq",
      "producer",
      "cluster",
      "vhosts",
      "policies",
      "replication",
      "definitions",
      "alerts",
      "acl",
    ]);
  });

  /*
   * Access control is the case the `requires` map exists for. RabbitMQ does not
   * implement `AccessAdmin` - RocketMQ's ACL shape does not fit its users and
   * permissions - so the page is reached through the identity capability
   * instead, and gating it on the RocketMQ one alone would hide a built page.
   */
  it("reaches the permissions page without RocketMQ's access capability", () => {
    const nav = navAvailability(state(RABBITMQ_CAPABILITIES), true);
    expect(RABBITMQ_CAPABILITIES).not.toContain(Capability.CapAccessControl);
    expect(nav.visible("acl")).toBe(true);
    expect(nav.disabled("acl")).toBe(false);
  });

  /*
   * A broker without the shovel and federation plugins keeps the page, greyed
   * out with the reason on it. Hiding it would make something a plugin away
   * look like something this app never built.
   */
  it("keeps the replication page, disabled, when the plugins are absent", () => {
    const withoutPlugins = RABBITMQ_CAPABILITIES.filter(
      (capability) => capability !== Capability.CapReplication,
    );
    const nav = navAvailability(
      state(withoutPlugins, {
        [Capability.CapReplication]: "mq.rabbitmq.degraded.replicationPlugin",
      }),
      true,
    );

    expect(nav.visible("replication")).toBe(true);
    expect(nav.disabled("replication")).toBe(true);
    expect(nav.reason("replication")).toBe("mq.rabbitmq.degraded.replicationPlugin");
  });

  /*
   * A broker with no management plugin degrades everything, and the sidebar
   * has to stay drawn: an empty one reads as an app with no features rather
   * than an endpoint that needs configuring.
   */
  it("keeps every page drawn and disabled when the whole admin plane is degraded", () => {
    const nav = navAvailability(
      state(
        [],
        Object.fromEntries(
          RABBITMQ_CAPABILITIES.map((capability) => [
            capability,
            "mq.rabbitmq.degraded.managementPlugin",
          ]),
        ),
      ),
      true,
    );

    for (const id of drawn) {
      expect(nav.visible(id), id).toBe(true);
      // Overview stands on its own and stays reachable to say what is wrong.
      if (id !== "overview") expect(nav.disabled(id), id).toBe(true);
    }
  });
});
