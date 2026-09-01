/**
 * What is wrong with a Pulsar cluster right now.
 *
 * None of RocketMQ's rules fit and running them would be worse than running
 * nothing: a broker ordinal, a commit log's disk percentage and a per-group
 * dead-letter topic are three things Pulsar never reports, so every rule would
 * read zero and no connection would ever raise an alert. That is why the
 * previous commit gave this family an empty rule list rather than letting it
 * fall through - an empty alerts page reads as a healthy cluster.
 *
 * What Pulsar reports instead is a subscription's own state, and the one that
 * matters most has no counterpart anywhere else: a subscription can be
 * *blocked*. Past its unacknowledged limit the broker stops delivering to it
 * entirely - the backlog then grows for a reason that is not the consumer's
 * speed, looks identical to a slow consumer from the backlog alone, and is
 * fixed somewhere completely different. It is the alert this family exists to
 * raise.
 *
 * There is no broker-offline rule, and its absence is deliberate. Pulsar's
 * active-broker listing simply stops listing a broker that has gone, so the
 * driver never marks one offline and a rule for it would be a switch for
 * something that cannot fire.
 *
 * There is no disk rule either: Pulsar's messages are BookKeeper's and the
 * broker reports no disk figure at all. What it does report is memory, which
 * is the watermark that actually stops a broker on this family.
 *
 * And there is no dead-letter rule, left out for cost rather than for meaning.
 * Finding a Pulsar dead-letter topic means walking a namespace and reading
 * every topic's depth - the same request-per-topic walk the subscription rules
 * already pay for - and doing it on a sixty-second sweep against every open
 * connection would double it for a question the dead-letter page answers on
 * demand.
 */
import type { Node, Subscription } from "@/api/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import { directMemoryPercent, memoryPercent } from "./cluster";
import { isBlocked, shortTopicOf, unackedCount } from "./subscriptions";

/** A subscription is named by its own name and its topic, because neither is
 * unique on its own. */
function subscriptionLabel(subscription: Subscription): string {
  return `${shortTopicOf(subscription)}/${subscription.ref.name}`;
}

export function derivePulsarAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold } = thresholds;

  for (const subscription of facts.consumerGroups) {
    /*
     * Blocked first, and critical, because it is the one an operator cannot
     * work out from the other columns. The broker has stopped dispatching;
     * acknowledging or raising maxUnackedMessagesPerSubscription is what
     * restarts it, and staring at the consumer will not.
     */
    if (rules.subscriptionBlocked && isBlocked(subscription)) {
      out.push({
        key: `sub-blocked-${subscriptionLabel(subscription)}`,
        ruleKey: "subscriptionBlocked",
        severity: "crit",
        params: {
          subscription: subscriptionLabel(subscription),
          unacked: unackedCount(subscription) ?? 0,
        },
        since: subscription.lastUpdated || undefined,
      });
      // Its backlog is a consequence of being blocked, so the lag rule below
      // would raise a second alert about the same thing.
      continue;
    }

    /*
     * A subscription with nothing attached is not automatically wrong on this
     * family - it is a stored cursor, and one created ahead of its consumer is
     * exactly the point - so this fires only when something is waiting for it.
     */
    const backlog = Number(subscription.backlog);
    if (rules.groupOffline && subscription.members === 0 && backlog > 0) {
      out.push({
        key: `sub-idle-${subscriptionLabel(subscription)}`,
        ruleKey: "groupOffline",
        severity: "warn",
        params: { group: subscriptionLabel(subscription), lag: backlog },
        since: subscription.lastUpdated || undefined,
      });
      continue;
    }

    if (
      rules.groupLag &&
      lagThreshold > 0 &&
      subscription.members > 0 &&
      backlog >= lagThreshold
    ) {
      out.push({
        key: `sub-lag-${subscriptionLabel(subscription)}`,
        ruleKey: "groupLag",
        severity: "warn",
        params: {
          group: subscriptionLabel(subscription),
          lag: backlog,
          threshold: lagThreshold,
        },
        since: subscription.lastUpdated || undefined,
      });
    }
  }

  /*
   * Memory rather than disk. Pulsar's messages are BookKeeper's and the broker
   * reports no disk figure, but it does report its heap and its direct memory
   * - and direct memory is where its network buffers live, so exhausting it
   * stops the broker accepting connections rather than slowing it down.
   */
  if (rules.memoryUsage && thresholds.disk > 0) {
    for (const node of facts.nodes) {
      const worst = worstMemory(node);
      if (worst != null && worst >= thresholds.disk) {
        out.push({
          key: `mem-${node.address}`,
          ruleKey: "memoryUsage",
          severity: worst >= 95 ? "crit" : "warn",
          params: { broker: node.address, usage: worst, threshold: thresholds.disk },
          since: node.lastSeen || undefined,
        });
      }
    }
  }

  return out;
}

/**
 * The higher of a broker's two memory figures, or null when it reported
 * neither.
 *
 * Null rather than zero: a broker the load manager did not describe has no
 * memory reading, and treating that as 0% would mean this rule never fires for
 * exactly the brokers nobody can see.
 */
function worstMemory(node: Node): number | null {
  const heap = memoryPercent(node);
  const direct = directMemoryPercent(node);
  if (heap == null && direct == null) return null;
  return Math.max(heap ?? 0, direct ?? 0);
}
