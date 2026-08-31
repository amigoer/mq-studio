/**
 * Navigation derived from what the connection can do.
 *
 * The sidebar used to be a constant and the disabled set a hardcoded list of
 * RocketMQ page ids. That works while every family answers every question and
 * breaks the moment one does not: MQTT has no destinations to list and no
 * groups to inspect, and an app that renders those entries greyed out reads as
 * broken rather than as honest about the broker.
 */
import { Capability } from "@bindings/model/models";
import type { CapabilityState } from "./capabilities";

/**
 * The capability a page needs to be worth showing at all.
 *
 * A list means any one of them will do: two families can answer the same page
 * by different means, and dead letters is where that first showed up. RocketMQ
 * has a dead-letter topic per consumer group and reads it like any other;
 * RabbitMQ has ordinary queues that something else dead-letters into, found by
 * walking the topology. Neither can answer the page the other's way, and both
 * answer it.
 */
const requires: Record<string, Capability | Capability[]> = {
  topics: Capability.CapDestinationList,
  consumers: Capability.CapSubscriptionList,
  // Only RabbitMQ has exchanges, and the sidebar is where that shows: a
  // family without them must not draw the entry at all.
  exchanges: Capability.CapRouting,
  messages: Capability.CapMessageQuery,
  dlq: [Capability.CapDLQ, Capability.CapDeadLetterTopology],
  vhosts: Capability.CapNamespaceList,
  policies: Capability.CapPolicyList,
  producer: Capability.CapPublish,
  cluster: Capability.CapClusterTopology,
  acl: [Capability.CapAccessControl, Capability.CapIdentityList],
  // Alerts needs no particular capability, only a connection to draw metrics
  // from, which the connected check below already covers.
  alerts: Capability.CapClusterMetrics,
};

/**
 * Pages that stand on their own: the shell and the landing page.
 *
 * Alerts is deliberately not here. Its rules are broker-agnostic numeric
 * comparisons, but it has nothing to compare until a connection reports
 * metrics.
 */
const alwaysAvailable = new Set(["home", "connections", "settings", "github"]);

export interface NavAvailability {
  /** False when the family has no such concept; the entry is not drawn. */
  visible: (id: string) => boolean;
  /** True when the entry is drawn but cannot be used yet. */
  disabled: (id: string) => boolean;
  /** Set when the endpoint reports why it cannot do this. */
  reason: (id: string) => string | undefined;
}

/**
 * Works out what to draw.
 *
 * Being offline disables nothing. Every board renders its own "not connected"
 * state, which says more than a dead sidebar does, and a nav that goes inert
 * the moment a broker drops takes away the one thing still worth doing -
 * looking at the other pages to see how far the outage reaches.
 *
 * What the sidebar does gate on is the endpoint's answer once it has one: a
 * capability it reports a reason for is drawn disabled with that reason, and
 * one the family has no concept of is not drawn at all.
 */
export function navAvailability(
  capabilities: CapabilityState,
  connected: boolean,
): NavAvailability {
  const asked = (id: string): Capability[] => {
    const wanted = requires[id];
    if (wanted == null) return [];
    return Array.isArray(wanted) ? wanted : [wanted];
  };
  const known = (id: string) =>
    asked(id).find(
      (capability) =>
        capabilities.has(capability) ||
        capabilities.degradedReason(capability) !== undefined,
    );
  // Before the endpoint answers, nothing is known; hiding pages that would
  // come back reads worse than showing them and finding out.
  const unknown = !connected || capabilities.loading;

  return {
    visible: (id) => {
      if (alwaysAvailable.has(id)) return true;
      if (asked(id).length === 0 || unknown) return true;
      return known(id) !== undefined;
    },
    disabled: (id) => {
      if (alwaysAvailable.has(id)) return false;
      if (asked(id).length === 0 || unknown) return false;
      // Usable if any one of the capabilities is plainly supported; degraded
      // on all of them is what disables the entry.
      return !asked(id).some((capability) => capabilities.has(capability));
    },
    reason: (id) => {
      const capability = known(id);
      return capability ? capabilities.degradedReason(capability) : undefined;
    },
  };
}
