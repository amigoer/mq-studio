/**
 * What is wrong with a RabbitMQ broker right now.
 *
 * None of RocketMQ's rules apply here and running them was worse than running
 * nothing: a broker ordinal, a consumer group's backlog and a commit log's
 * disk usage are three figures RabbitMQ never reports, so every rule read zero
 * and no connection ever raised an alert.
 *
 * What it does report is its own resource alarms, and they are the ones that
 * matter: an alarm is not a warning about the future, it is the broker having
 * already stopped accepting publishes.
 */
import type { ClientConnection } from "@bindings/model/models";
import type { Node } from "@/api/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import {
  diskFreeAlarm,
  diskHeadroomUsage,
  memoryAlarm,
  memoryUsage,
  nodeName,
  partitions,
} from "./nodes";
import { messagesReady, messagesUnacknowledged, vhost } from "./destinations";

/** A queue is named by its virtual host too: the name alone is not unique. */
function queueLabel(namespace: string, name: string): string {
  return namespace === "/" ? name : `${namespace}/${name}`;
}

/** Which alarm is on, for a node that has one. */
function alarmKind(node: Node): "memory" | "disk" | "both" | null {
  const memory = memoryAlarm(node);
  const disk = diskFreeAlarm(node);
  if (memory && disk) return "both";
  if (memory) return "memory";
  if (disk) return "disk";
  return null;
}

/*
 * Flow control is the broker throttling a publisher it cannot keep up with,
 * and blocked is the harder version of the same thing: the connection has been
 * stopped outright by a resource alarm. Both are states of a connection rather
 * than of the broker, so they are counted rather than listed - one row saying
 * forty connections are throttled is the alert; forty rows is a log.
 */
function throttled(connections: readonly ClientConnection[]): ClientConnection[] {
  return connections.filter(
    (connection) =>
      connection.state === "flow" ||
      connection.state === "blocked" ||
      connection.state === "blocking",
  );
}

export function deriveRabbitMQAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold, disk: diskThreshold } = thresholds;

  for (const node of facts.nodes) {
    if (rules.brokerOffline && node.status === "offline") {
      out.push({
        key: `node-off-${nodeName(node)}`,
        ruleKey: "brokerOffline",
        severity: "crit",
        params: { broker: nodeName(node), address: node.address || "—" },
        since: node.lastSeen || undefined,
      });
      // A node that is not answering reports stale memory and disk figures,
      // and alarming on those would be alarming on the last thing it said
      // before it went.
      continue;
    }

    /*
     * The alarm, not the watermark. RabbitMQ raises this itself when memory or
     * free disk crosses the limit it was configured with, and while it is up
     * every publisher on the node is blocked. Nothing else in this list stops
     * an application from working.
     */
    const alarm = alarmKind(node);
    if (rules.resourceAlarm && alarm != null) {
      out.push({
        key: `alarm-${nodeName(node)}-${alarm}`,
        ruleKey: "resourceAlarm",
        severity: "crit",
        params: { broker: nodeName(node), resource: alarm },
        since: node.lastSeen || undefined,
      });
    }

    /*
     * A partition is the cluster running as two halves that each believe they
     * are whole. It stays until someone resolves it, and until then the two
     * halves are accepting writes the other cannot see.
     */
    const lost = partitions(node);
    if (rules.nodePartition && lost.length > 0) {
      out.push({
        key: `partition-${nodeName(node)}`,
        ruleKey: "nodePartition",
        severity: "crit",
        params: { broker: nodeName(node), peers: lost.join(", "), count: lost.length },
        since: node.lastSeen || undefined,
      });
    }

    if (diskThreshold <= 0) continue;

    /*
     * The approach to the alarm, before it fires. Disk is headroom against the
     * floor RabbitMQ alarms at rather than a percentage of the disk - the
     * broker never reports the size of the disk - so this says how close the
     * free space is to that floor. It is suppressed once the alarm is up: the
     * alarm is the same fact, already stated at the severity it deserves.
     */
    if (rules.diskUsage && !diskFreeAlarm(node)) {
      const headroom = diskHeadroomUsage(node);
      if (headroom != null && headroom >= diskThreshold) {
        out.push({
          key: `disk-${nodeName(node)}`,
          ruleKey: "diskUsage",
          severity: headroom >= Math.min(100, diskThreshold + 15) ? "crit" : "warn",
          params: { broker: nodeName(node), usage: headroom, threshold: diskThreshold },
          since: node.lastSeen || undefined,
        });
      }
    }

    if (rules.memoryUsage && !memoryAlarm(node)) {
      const usage = memoryUsage(node);
      if (usage != null && usage >= diskThreshold) {
        out.push({
          key: `memory-${nodeName(node)}`,
          ruleKey: "memoryUsage",
          severity: usage >= Math.min(100, diskThreshold + 15) ? "crit" : "warn",
          params: { broker: nodeName(node), usage, threshold: diskThreshold },
          since: node.lastSeen || undefined,
        });
      }
    }
  }

  if (lagThreshold > 0) {
    for (const queue of facts.destinations) {
      const ready = messagesReady(queue);
      const depth = ready + messagesUnacknowledged(queue);
      const consumers = queue.subscribers ?? 0;
      const label = queueLabel(vhost(queue), queue.ref.name);

      /*
       * Nobody reading is the worse of the two and excludes the plain backlog
       * alert: one abandoned queue must not raise two rows. Ready rather than
       * depth, because unacknowledged messages are held by a consumer that
       * exists - a queue can only be unattended if what is waiting is waiting
       * for nobody.
       */
      if (rules.queueNoConsumer && consumers === 0 && ready > lagThreshold) {
        out.push({
          key: `queue-idle-${label}`,
          ruleKey: "queueNoConsumer",
          severity: "crit",
          params: { queue: label, lag: ready },
        });
      } else if (rules.queueBacklog && depth > lagThreshold) {
        out.push({
          key: `queue-backlog-${label}`,
          ruleKey: "queueBacklog",
          severity: "warn",
          params: { queue: label, lag: depth, threshold: lagThreshold },
        });
      }
    }
  }

  if (rules.flowControl) {
    const slowed = throttled(facts.connections);
    const first = slowed[0];
    if (first != null) {
      out.push({
        key: "flow-control",
        ruleKey: "flowControl",
        severity: "warn",
        params: { count: slowed.length, peer: first.peerHost || first.name },
      });
    }
  }

  return out;
}
