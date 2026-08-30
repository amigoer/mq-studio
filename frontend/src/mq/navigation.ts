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

/** The capability a page needs to be worth showing at all. */
const requires: Record<string, Capability> = {
  topics: Capability.CapDestinationList,
  consumers: Capability.CapSubscriptionList,
  // Only RabbitMQ has exchanges, and the sidebar is where that shows: a
  // family without them must not draw the entry at all.
  exchanges: Capability.CapRouting,
  messages: Capability.CapMessageQuery,
  dlq: Capability.CapDLQ,
  producer: Capability.CapPublish,
  cluster: Capability.CapClusterTopology,
  acl: Capability.CapAccessControl,
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
  const capabilityFor = (id: string) => requires[id];
  // Before the endpoint answers, nothing is known; hiding pages that would
  // come back reads worse than showing them and finding out.
  const unknown = !connected || capabilities.loading;

  return {
    visible: (id) => {
      if (alwaysAvailable.has(id)) return true;
      const capability = capabilityFor(id);
      if (!capability || unknown) return true;
      return (
        capabilities.has(capability) ||
        capabilities.degradedReason(capability) !== undefined
      );
    },
    disabled: (id) => {
      if (alwaysAvailable.has(id)) return false;
      const capability = capabilityFor(id);
      if (!capability || unknown) return false;
      return !capabilities.has(capability);
    },
    reason: (id) => {
      const capability = capabilityFor(id);
      return capability ? capabilities.degradedReason(capability) : undefined;
    },
  };
}
