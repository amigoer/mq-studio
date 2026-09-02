/**
 * What is wrong with a Redis server right now.
 *
 * None of the other families' rules fit. RocketMQ's read a broker ordinal, a
 * commit log's disk percentage and a dead-letter topic; Kafka's read partition
 * state. Redis reports none of those, so every rule would read zero and no
 * connection would ever raise an alert - which is worse than raising nothing,
 * because the page would look like it was working.
 *
 * What Redis reports instead is memory against its own cap, whether the last
 * background save succeeded, and - for streams - what a consumer group has
 * been handed and never acknowledged. The last is the one with no counterpart
 * anywhere else: a group with entries pending and nothing attached is work
 * that stopped, and nothing is coming back for it until somebody claims it.
 */
import type { Node, Subscription } from "@/api/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import { memoryUsagePercent, persistenceHealthy } from "./nodes";
import { groupName, groupStream, health, lag, pending } from "./subscriptions";

function serverLabel(node: Node): string {
  return node.address === "" ? node.name : node.address;
}

/** A group is named by both halves: its name alone is not unique. */
function groupLabel(group: Subscription): string {
  return `${groupStream(group)} / ${groupName(group)}`;
}

export function deriveRedisAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold, disk: memoryThreshold } = thresholds;

  for (const node of facts.nodes) {
    /*
     * A node the driver marked offline. On a standalone connection this cannot
     * fire - if the server were down there would be no facts at all - so in
     * practice it is a cluster member that did not answer its own INFO.
     */
    if (rules.brokerOffline && node.status === "offline") {
      out.push({
        key: `redis-off-${serverLabel(node)}`,
        ruleKey: "brokerOffline",
        severity: "crit",
        params: { node: serverLabel(node) },
      });
    }

    /*
     * The last background save failed. The server is answering every request
     * and its data is not being written down, which no other figure shows and
     * which a restart turns into data loss.
     */
    if (rules.resourceAlarm && persistenceHealthy(node) === false) {
      out.push({
        key: `redis-save-${serverLabel(node)}`,
        ruleKey: "resourceAlarm",
        severity: "crit",
        params: { node: serverLabel(node) },
      });
    }

    /*
     * Memory against the server's own cap, and only where there is one. A
     * server with no maxmemory has nothing to be a percentage of, and treating
     * "no cap" as 0% would silence the rule on exactly the servers where
     * running out is worst.
     */
    const usage = memoryUsagePercent(node);
    if (rules.memoryUsage && memoryThreshold > 0 && usage != null && usage >= memoryThreshold) {
      out.push({
        key: `redis-mem-${serverLabel(node)}`,
        ruleKey: "memoryUsage",
        severity: usage >= 95 ? "crit" : "warn",
        params: { node: serverLabel(node), usage },
      });
    }
  }

  for (const group of facts.consumerGroups) {
    /*
     * Entries handed out and never acknowledged, with nothing attached to
     * finish them. This is the rule Redis exists to have: the entries are not
     * lost and not delivered, they are simply owed to a consumer that is gone,
     * and no amount of waiting changes that.
     */
    if (rules.groupOffline && health(group) === "stalled") {
      out.push({
        key: `redis-stalled-${groupLabel(group)}`,
        ruleKey: "groupOffline",
        severity: "warn",
        params: { group: groupLabel(group), pending: pending(group) ?? 0 },
      });
    }

    /*
     * A group falling behind the end of its stream. Null is not zero: once
     * entries a group had not read are deleted Redis stops being able to count
     * the lag, and firing on that would be firing on a number nobody has.
     */
    const behind = lag(group);
    if (rules.groupLag && lagThreshold > 0 && behind != null && behind >= lagThreshold) {
      out.push({
        key: `redis-lag-${groupLabel(group)}`,
        ruleKey: "groupLag",
        severity: "warn",
        params: { group: groupLabel(group), lag: behind },
      });
    }
  }

  return out;
}
