/**
 * What is wrong with an MQTT broker right now.
 *
 * None of RocketMQ's rules fit and running them would be worse than running
 * nothing: a broker ordinal, a commit log's disk percentage and a dead-letter
 * topic are three things MQTT never reports, so every rule would read zero and
 * no connection would ever raise an alert. That is what MQTT got before this
 * file existed - an alerts page that could not fire.
 *
 * What MQTT has instead is the session. A session can outlive the connection
 * that made it, and while it does the broker keeps queueing for a client that
 * is not there: it costs memory, it is invisible from the device's side, and
 * it ends only when the session expires or somebody disconnects it. When the
 * queue fills, the broker starts discarding - silently, and the count is the
 * only trace.
 *
 * Three existing rule keys carry all of it, so nothing new is added to the
 * settings page: a session queueing with nobody attached is queueNoConsumer,
 * a queue past the threshold is queueBacklog, and a node the broker reports as
 * down is brokerOffline. The words differ from a queue's but the questions are
 * the same ones, and inventing MQTT-only switches for them would give an
 * operator three more toggles that mean what three they already have mean.
 */
import type { ClientConnection } from "@bindings/model/models";
import type { AlertFacts, AlertThresholds, DerivedAlert } from "@/lib/alertDerive";
import type { AlertRulePrefs } from "@/lib/alertRules";
import { clientSession, isOrphanedSession } from "./clients";

/** A session is named by its client id, which is its identity on the broker. */
function sessionLabel(client: ClientConnection): string {
  return client.name;
}

export function deriveMqttAlerts(
  facts: AlertFacts,
  rules: AlertRulePrefs,
  thresholds: AlertThresholds,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const { lag: lagThreshold } = thresholds;

  /*
   * A node the broker itself reports as down.
   *
   * Only a management API can produce this: over the protocol alone the one
   * node is the socket this session is on, and it is online by definition
   * while there is anything to read.
   */
  for (const node of facts.nodes) {
    if (rules.brokerOffline && node.status === "offline") {
      out.push({
        key: `broker-off-${node.name}`,
        ruleKey: "brokerOffline",
        severity: "crit",
        params: { broker: node.name, address: node.address || "—", role: "broker" },
        since: node.lastSeen || undefined,
      });
    }
  }

  for (const client of facts.connections) {
    const session = clientSession(client);
    const queued = session.queued ?? 0;
    const label = sessionLabel(client);

    /*
     * A session holding messages for a client that is not connected.
     *
     * The MQTT shape of "a queue nothing is consuming": the broker has work
     * for somebody and there is nobody there. It is bounded by the session
     * expiry rather than by a consumer arriving, which is why it is critical
     * rather than a warning - left alone it ends in the drop below.
     */
    if (rules.queueNoConsumer && isOrphanedSession(client) && queued > lagThreshold) {
      out.push({
        key: `session-idle-${label}`,
        ruleKey: "queueNoConsumer",
        severity: "crit",
        params: { queue: label, lag: queued },
      });
    } else if (rules.queueBacklog && queued > lagThreshold) {
      out.push({
        key: `session-backlog-${label}`,
        ruleKey: "queueBacklog",
        severity: "warn",
        params: { queue: label, lag: queued, threshold: lagThreshold },
      });
    }

    /*
     * A queue that has already started discarding.
     *
     * Not a threshold: any drop at all is a message the broker accepted and
     * then threw away, and nothing else in the app would ever show it.
     */
    if (rules.queueBacklog && (session.queueDropped ?? 0) > 0) {
      out.push({
        key: `session-dropped-${label}`,
        ruleKey: "queueBacklog",
        severity: "crit",
        params: { queue: label, lag: session.queueDropped ?? 0, threshold: 0 },
      });
    }
  }

  return out;
}
