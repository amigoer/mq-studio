/**
 * What is wrong with a RocketMQ cluster right now.
 *
 * Lifted out of `lib/alertDerive` unchanged: these rules read broker ordinals,
 * consumer group backlog and commit log disk usage, which are RocketMQ's
 * vocabulary and nobody else's. They used to run against every family, so a
 * RabbitMQ connection was measured for figures it never reports.
 */
import type { Node } from "@/api/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import { dlqCount, groupName } from "./subscriptions";
import { brokerId, brokerName, commitLogDiskUsage } from "./nodes";

/*
 * A broker's ordinal distinguishes the members of one broker group, and 0 is
 * the master. A node that reports none is named by its group alone.
 */
function brokerLabel(node: Node): string {
  const ordinal = brokerId(node);
  return ordinal !== 0 ? `${brokerName(node)}-${ordinal}` : brokerName(node);
}

export function deriveRocketMQAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold, disk: diskThreshold } = thresholds;

  if (rules.brokerOffline) {
    for (const node of facts.nodes) {
      if (node.status !== "offline") continue;
      out.push({
        key: `broker-off-${brokerName(node)}-${brokerId(node)}`,
        ruleKey: "brokerOffline",
        severity: "crit",
        params: { broker: brokerLabel(node), address: node.address || "—" },
        since: node.lastSeen || undefined,
      });
    }
  }

  for (const group of facts.consumerGroups) {
    const lag = Number(group.backlog ?? 0);
    /*
     * A group with backlog and nobody reading it is the worse of the two and
     * excludes the plain lag alert: one stalled group must not raise two rows.
     */
    if (
      lagThreshold > 0 &&
      rules.groupOffline &&
      group.status === "offline" &&
      lag > lagThreshold &&
      (group.members ?? 0) === 0
    ) {
      out.push({
        key: `group-off-${groupName(group)}`,
        ruleKey: "groupOffline",
        severity: "crit",
        params: { group: groupName(group), lag },
        since: group.lastUpdated || undefined,
      });
    } else if (lagThreshold > 0 && rules.groupLag && lag > lagThreshold) {
      out.push({
        key: `group-lag-${groupName(group)}`,
        ruleKey: "groupLag",
        severity: "warn",
        params: { group: groupName(group), lag, threshold: lagThreshold },
        since: group.lastUpdated || undefined,
      });
    }

    const dead = dlqCount(group) ?? 0;
    if (rules.dlqGrowth && dead > 0) {
      out.push({
        key: `dlq-${groupName(group)}`,
        ruleKey: "dlqGrowth",
        severity: "info",
        params: { group: groupName(group), count: dead },
      });
    }
  }

  if (rules.diskUsage && diskThreshold > 0) {
    for (const node of facts.nodes) {
      const usage = Number(commitLogDiskUsage(node) ?? 0);
      if (usage < diskThreshold) continue;
      out.push({
        key: `disk-${brokerName(node)}-${brokerId(node)}`,
        ruleKey: "diskUsage",
        // Fifteen points past the threshold is where a warning stops being one.
        severity: usage >= Math.min(100, diskThreshold + 15) ? "crit" : "warn",
        params: {
          broker: brokerLabel(node),
          usage: Math.round(usage),
          threshold: diskThreshold,
        },
        since: node.lastSeen || undefined,
      });
    }
  }

  return out;
}
