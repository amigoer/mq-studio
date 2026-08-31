/**
 * What is wrong with a Kafka cluster right now.
 *
 * None of RocketMQ's rules fit and running them would be worse than running
 * nothing: a broker ordinal, a commit log's disk percentage and a dead-letter
 * topic are three things Kafka never reports, so every rule would read zero
 * and no connection would ever raise an alert.
 *
 * What Kafka reports instead is partition state, and it is the whole answer.
 * Under-replicated means a follower has fallen behind and the topic's
 * durability is not what it was configured to be. Offline means a replica is
 * unreachable. Leaderless means the partition is neither readable nor writable
 * at all - three degrees of the same trouble, and worth separating because the
 * first is a warning and the last is an outage.
 */
import type { Destination, Node, Subscription } from "@/api/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import {
  leaderlessPartitions,
  offlinePartitions,
  underReplicatedPartitions,
} from "./destinations";
import { hasMembers, isEmpty, totalLag } from "./subscriptions";
import { isController, nodeID } from "./cluster";

/** A broker is named by its id, which is what every Kafka tool calls it. */
function brokerLabel(node: Node): string {
  const id = nodeID(node);
  return id === "" ? node.name : `broker-${id}`;
}

function topicLabel(topic: Destination): string {
  return topic.ref.name;
}

function groupLabel(group: Subscription): string {
  return group.ref.name;
}

export function deriveKafkaAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold } = thresholds;

  /*
   * A broker missing from metadata is a broker that is down. Kafka does not
   * report an offline broker - it stops reporting it at all - so this fires on
   * a node the driver marked offline rather than on one that is absent, and a
   * cluster that has lost a broker shows it through its partitions instead.
   */
  for (const node of facts.nodes) {
    if (rules.brokerOffline && node.status === "offline") {
      out.push({
        key: `broker-off-${brokerLabel(node)}`,
        ruleKey: "brokerOffline",
        severity: "crit",
        params: {
          broker: brokerLabel(node),
          address: node.address || "—",
          role: isController(node) ? "controller" : "broker",
        },
        since: node.lastSeen || undefined,
      });
    }
  }

  for (const topic of facts.destinations) {
    /*
     * Leaderless first, and only that one when it is true: a partition with no
     * leader is also under-replicated and also offline, and raising three
     * alerts for one partition would bury the one that matters.
     */
    const leaderless = leaderlessPartitions(topic);
    if (rules.partitionLeaderless && leaderless > 0) {
      out.push({
        key: `leaderless-${topicLabel(topic)}`,
        ruleKey: "partitionLeaderless",
        severity: "crit",
        params: { topic: topicLabel(topic), count: leaderless },
      });
      continue;
    }

    const offline = offlinePartitions(topic);
    if (rules.partitionOffline && offline > 0) {
      out.push({
        key: `offline-${topicLabel(topic)}`,
        ruleKey: "partitionOffline",
        severity: "crit",
        params: { topic: topicLabel(topic), count: offline },
      });
      continue;
    }

    /*
     * The warning rather than the outage: the topic still works and is no
     * longer as durable as it was asked to be. If min.insync.replicas is met
     * nothing has stopped yet, which is exactly when this is worth seeing.
     */
    const underReplicated = underReplicatedPartitions(topic);
    if (rules.partitionUnderReplicated && underReplicated > 0) {
      out.push({
        key: `urp-${topicLabel(topic)}`,
        ruleKey: "partitionUnderReplicated",
        severity: "warn",
        params: { topic: topicLabel(topic), count: underReplicated },
      });
    }
  }

  for (const group of facts.consumerGroups) {
    const lag = totalLag(group);

    /*
     * A group with committed offsets, a backlog and nothing connected. Either
     * a deployment gap or a consumer that died, and the difference matters
     * enough to say rather than to guess: this is the one alert that catches
     * a consumer stopping quietly.
     */
    if (rules.groupOffline && isEmpty(group) && !hasMembers(group) && (lag ?? 0) > 0) {
      out.push({
        key: `group-empty-${groupLabel(group)}`,
        ruleKey: "groupOffline",
        severity: "crit",
        params: { group: groupLabel(group), lag: lag ?? 0 },
      });
      continue;
    }

    // A lag nobody could measure is not a lag of zero, and must not be
    // compared against a threshold as though it were.
    if (rules.groupLag && lagThreshold > 0 && lag != null && lag >= lagThreshold) {
      out.push({
        key: `group-lag-${groupLabel(group)}`,
        ruleKey: "groupLag",
        severity: lag >= lagThreshold * 5 ? "crit" : "warn",
        params: { group: groupLabel(group), lag, threshold: lagThreshold },
      });
    }
  }

  return out;
}
