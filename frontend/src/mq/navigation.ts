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
  messages: Capability.CapMessageQuery,
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
 * metrics, and it was disabled while offline before this refactor.
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
 * With nothing connected every broker-backed entry is visible but disabled,
 * which is what the app did before and is the right read: the user has not
 * been told these pages do not exist, only that they need a connection.
 */
export function navAvailability(
  capabilities: CapabilityState,
  connected: boolean,
): NavAvailability {
  const capabilityFor = (id: string) => requires[id];

  return {
    visible: (id) => {
      if (alwaysAvailable.has(id)) return true;
      const capability = capabilityFor(id);
      if (!capability) return true;
      // Before connecting, show everything: nothing is known yet, and hiding
      // pages that would come back is worse than disabling them.
      if (!connected || capabilities.loading) return true;
      return (
        capabilities.has(capability) ||
        capabilities.degradedReason(capability) !== undefined
      );
    },
    disabled: (id) => {
      if (alwaysAvailable.has(id)) return false;
      if (!connected) return true;
      const capability = capabilityFor(id);
      if (!capability) return false;
      return !capabilities.has(capability);
    },
    reason: (id) => {
      const capability = capabilityFor(id);
      return capability ? capabilities.degradedReason(capability) : undefined;
    },
  };
}
