/**
 * The alert rules, as a pure function of one connection's cluster snapshot.
 *
 * Shared by the alerts page, which reads the single connection its tab is
 * scoped to, and by the notification centre, which fans out across every open
 * one. The rules cannot live in either: two copies drift the moment a
 * threshold moves.
 *
 * Nothing here is localised. A record outlives the language it fired in -- the
 * centre keeps resolved alerts to draw them as recovered -- so what is stored
 * is the rule and its numbers, and the words are chosen at render.
 */
import type { Node, Subscription } from "@/api/models";
import type { AlertRuleKey, AlertRulePrefs } from "@/lib/alertRules";
import { dlqCount, groupName } from "@/mq/rocketmq/subscriptions";
import { brokerId, brokerName, commitLogDiskUsage } from "@/mq/rocketmq/nodes";

export type AlertSeverity = "crit" | "warn" | "info";

/** What the rules read. Both lists come from one settled poll of a connection. */
export interface AlertFacts {
  nodes: readonly Node[];
  consumerGroups: readonly Subscription[];
}

export interface AlertThresholds {
  /** Backlog that counts as a lag alert. Zero disables both group rules. */
  lag: number;
  /** Disk percentage that counts as a water-level alert. Zero disables it. */
  disk: number;
}

export interface DerivedAlert {
  /** Stable across polls, so an alert that keeps firing keeps its record. */
  key: string;
  ruleKey: AlertRuleKey;
  severity: AlertSeverity;
  /** Interpolated into `alerts.rule.*` and `alerts.detail.*` at render. */
  params: Readonly<Record<string, string | number>>;
  /** What the broker last said about when this started, when it says anything. */
  since?: string;
}

function severityWeight(severity: AlertSeverity): number {
  return severity === "crit" ? 3 : severity === "warn" ? 2 : 1;
}

/*
 * `brokerId` and `dlqCount` read RocketMQ attributes. On a driver that sets
 * neither they read 0, which reads as "no broker ordinal" and "no dead
 * letters" -- the rules then simply do not fire, which is the right answer
 * until a driver reports the figure.
 */
function brokerLabel(node: Node): string {
  const ordinal = brokerId(node);
  return ordinal !== 0 ? `${brokerName(node)}-${ordinal}` : brokerName(node);
}

/** Every rule the prefs leave enabled, worst first. */
export function deriveAlerts(
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

  return out.sort(
    (left, right) => severityWeight(right.severity) - severityWeight(left.severity),
  );
}
