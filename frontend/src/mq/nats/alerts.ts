/**
 * What is wrong with a NATS cluster right now.
 *
 * RocketMQ's rules, which every family without its own falls back to, read a
 * broker ordinal, a commit log's disk percentage and a dead-letter topic. NATS
 * reports none of those, so a connection left on the default rules would run
 * five rules that all read zero and could never fire - an alerts page that
 * looks armed and is not.
 *
 * What NATS has instead is a Raft group per stream and a server that drops
 * clients. Two of its five rules are borrowed - a consumer's backlog and a
 * push consumer with nothing bound are the same questions every family asks -
 * and three are its own, because nothing else here has them.
 */
import type { Destination, Subscription } from "@/api/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import { clusterName, leader, replicas, replicasHealthy, streamName } from "./destinations";
import { backlog, consumerName, isPush, members, streamOf } from "./subscriptions";
import { slowConsumers } from "./cluster";

export function deriveNatsAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold } = thresholds;

  for (const stream of facts.destinations) {
    /*
     * A stream whose Raft group has no leader.
     *
     * The JetStream failure: without a leader the stream accepts no publishes
     * and answers no reads, and nothing else on the page shows it - the stream
     * is still listed, still configured, still holding its messages. Only
     * meaningful on a clustered stream, because a server outside a cluster
     * reports no cluster at all rather than a cluster of one.
     */
    if (rules.streamNoLeader && clusterName(stream) != null && isLeaderless(stream)) {
      out.push({
        key: `stream-no-leader-${streamName(stream)}`,
        ruleKey: "streamNoLeader",
        severity: "crit",
        params: { stream: streamName(stream), replicas: replicas(stream) ?? 0 },
      });
    } else if (rules.streamUnderReplicated && replicasHealthy(stream) === false) {
      /*
       * A peer behind or offline. Separate from the rule above rather than a
       * milder version of it: a stream that has just been given another
       * replica is behind on purpose while it catches up, and the operator
       * doing that wants this one switch off without losing the leaderless
       * alarm.
       */
      out.push({
        key: `stream-replicas-${streamName(stream)}`,
        ruleKey: "streamUnderReplicated",
        severity: "warn",
        params: { stream: streamName(stream), replicas: replicas(stream) ?? 0 },
      });
    }
  }

  for (const consumer of facts.consumerGroups) {
    const pending = backlog(consumer);
    const label = consumerLabel(consumer);

    /*
     * A push consumer the server has a subject to deliver to and nobody
     * listening on.
     *
     * Push only, and the exclusion is the point. A pull consumer holds nothing
     * open between polls, so "nothing attached" is how it works rather than a
     * fault - alerting on it would fire against every healthy pull consumer in
     * the cluster every time the sweep landed between two fetches.
     */
    if (rules.groupOffline && isPush(consumer) && members(consumer) === 0 && pending > 0) {
      out.push({
        key: `consumer-unbound-${label}`,
        ruleKey: "groupOffline",
        severity: "crit",
        params: { group: label, lag: pending },
      });
    } else if (rules.groupLag && lagThreshold > 0 && pending > lagThreshold) {
      out.push({
        key: `consumer-lag-${label}`,
        ruleKey: "groupLag",
        severity: "warn",
        params: { group: label, lag: pending, threshold: lagThreshold },
      });
    }
  }

  for (const server of facts.nodes) {
    /*
     * Clients this server has disconnected for falling behind.
     *
     * NATS's signature failure, and one no other family here has: rather than
     * blocking a publisher or letting a queue grow, the server writes to a
     * subscriber until its pending bytes pass the limit and then drops the
     * socket. The client reconnects and misses whatever went past meanwhile,
     * so from the application's side the messages simply were not delivered.
     *
     * A count rather than a threshold, because the counter only ever goes up:
     * it is a total since the server started, so any value at all means this
     * has happened, and nothing here can say when.
     */
    const dropped = slowConsumers(server) ?? 0;
    if (rules.slowConsumer && dropped > 0) {
      out.push({
        key: `slow-consumer-${server.name}`,
        ruleKey: "slowConsumer",
        severity: "warn",
        params: { broker: server.name, count: dropped },
      });
    }
  }

  return out;
}

/**
 * A stream with no leader.
 *
 * The driver writes the leader's name only when the stream reports one, so an
 * absent attribute is the leaderless state rather than a field it forgot.
 */
function isLeaderless(stream: Destination): boolean {
  const name = leader(stream);
  return name == null || name === "";
}

/** A consumer is named within its stream, and two streams may hold the same name. */
function consumerLabel(consumer: Subscription): string {
  const stream = streamOf(consumer);
  return stream === "" ? consumerName(consumer) : `${stream}/${consumerName(consumer)}`;
}
