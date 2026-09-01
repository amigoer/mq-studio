import { MQKind } from "@bindings/model/models";

export type AlertRuleKey =
  | "brokerOffline"
  | "groupOffline"
  | "groupLag"
  | "diskUsage"
  | "dlqGrowth"
  | "resourceAlarm"
  | "nodePartition"
  | "memoryUsage"
  | "queueBacklog"
  | "queueNoConsumer"
  | "flowControl"
  // Kafka's three degrees of partition trouble. Separate keys because they are
  // separate switches: a cluster mid-reassignment is under-replicated on
  // purpose and its operator wants that one off, not all three.
  | "partitionUnderReplicated"
  | "partitionOffline"
  | "partitionLeaderless"
  /*
   * Pulsar's own, and it has no counterpart on any other family: past its
   * unacknowledged limit the broker stops delivering to a subscription
   * entirely. From the backlog alone that is indistinguishable from a slow
   * consumer, and it is fixed by acknowledging or raising a limit rather than
   * by looking at the consumer - so it is a separate switch and a separate
   * alert.
   */
  | "subscriptionBlocked";

export type AlertRulePrefs = Record<AlertRuleKey, boolean>;

/** Every rule, in the order a list of them reads best: worst first. */
export const ALERT_RULE_KEYS: readonly AlertRuleKey[] = [
  "brokerOffline",
  "subscriptionBlocked",
  "resourceAlarm",
  "nodePartition",
  "partitionLeaderless",
  "partitionOffline",
  "partitionUnderReplicated",
  "groupOffline",
  "queueNoConsumer",
  "groupLag",
  "queueBacklog",
  "diskUsage",
  "memoryUsage",
  "flowControl",
  "dlqGrowth",
];

/*
 * Which rules a family can actually raise.
 *
 * The switches are stored for every rule regardless, because a window can hold
 * connections to two families at once and a toggle is a preference rather than
 * a fact about a broker. What this decides is which ones are worth showing:
 * offering "consumer group has no instances" against RabbitMQ would be
 * offering a switch for something that cannot happen.
 */
const RULES_BY_KIND: Partial<Record<MQKind, readonly AlertRuleKey[]>> = {
  [MQKind.KindKafka]: [
    "brokerOffline",
    "partitionLeaderless",
    "partitionOffline",
    "partitionUnderReplicated",
    "groupOffline",
    "groupLag",
  ],
  /*
   * No brokerOffline, no diskUsage and no dlqGrowth, and all three absences
   * are deliberate.
   * Pulsar's active-broker listing stops listing a broker that has gone rather
   * than reporting it offline, so the driver never marks one - a switch for it
   * would be a switch for something that cannot fire. The messages are
   * BookKeeper's, so no broker reports a disk figure at all; memory is the
   * watermark that actually stops one on this family.
   *
   * dlqGrowth is the one left out for cost rather than for meaning. A Pulsar
   * dead-letter topic is found by walking a namespace and reading every
   * topic's depth, which is the same request-per-topic walk the subscription
   * rules already pay for - offering it here would double the sweep against
   * every open connection, every minute, for a page that answers the same
   * question on demand.
   */
  [MQKind.KindPulsar]: [
    "subscriptionBlocked",
    "groupOffline",
    "groupLag",
    "memoryUsage",
  ],
  [MQKind.KindRabbitMQ]: [
    "brokerOffline",
    "resourceAlarm",
    "nodePartition",
    "queueNoConsumer",
    "queueBacklog",
    "diskUsage",
    "memoryUsage",
    "flowControl",
  ],
};

const ROCKETMQ_RULES: readonly AlertRuleKey[] = [
  "brokerOffline",
  "groupOffline",
  "groupLag",
  "diskUsage",
  "dlqGrowth",
];

export function rulesFor(kind: MQKind | undefined): readonly AlertRuleKey[] {
  if (kind == null) return ALERT_RULE_KEYS;
  return RULES_BY_KIND[kind] ?? ROCKETMQ_RULES;
}

const STORAGE_KEY = "mq-studio:alert-rules";

export const DEFAULT_ALERT_RULES: AlertRulePrefs = {
  brokerOffline: true,
  groupOffline: true,
  groupLag: true,
  diskUsage: true,
  dlqGrowth: true,
  resourceAlarm: true,
  nodePartition: true,
  memoryUsage: true,
  queueBacklog: true,
  queueNoConsumer: true,
  flowControl: true,
  subscriptionBlocked: true,
  partitionUnderReplicated: true,
  partitionOffline: true,
  partitionLeaderless: true,
};

function read(): AlertRulePrefs {
  if (typeof window === "undefined") return { ...DEFAULT_ALERT_RULES };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ALERT_RULES };
    const parsed = JSON.parse(raw) as Partial<AlertRulePrefs>;
    return { ...DEFAULT_ALERT_RULES, ...parsed };
  } catch {
    return { ...DEFAULT_ALERT_RULES };
  }
}

/*
 * One snapshot for the whole window.
 *
 * The alerts page and the notification centre both read these, and a toggle on
 * the page has to reach the centre in the same tick -- two hooks each holding
 * their own useState copy would leave the bell counting rows the page had just
 * switched off. The identity is stable until a write, which is what
 * useSyncExternalStore needs to avoid an infinite re-render.
 */
let current: AlertRulePrefs = read();
const listeners = new Set<() => void>();

export function getAlertRules(): AlertRulePrefs {
  return current;
}

export function subscribeAlertRules(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function same(left: AlertRulePrefs, right: AlertRulePrefs): boolean {
  return (Object.keys(DEFAULT_ALERT_RULES) as AlertRuleKey[]).every(
    (key) => left[key] === right[key],
  );
}

/**
 * Re-reads storage, keeping the cached identity when nothing changed.
 *
 * Something outside this module may have written the key -- another window, or
 * a restore -- so this is a real read; holding the identity when the content
 * matches is what keeps `getAlertRules` usable as a store snapshot.
 */
export function loadAlertRules(): AlertRulePrefs {
  const fresh = read();
  if (!same(fresh, current)) current = fresh;
  return current;
}

export function saveAlertRules(rules: AlertRulePrefs): void {
  current = rules;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // ignore quota / private mode
  }
  for (const listener of listeners) listener();
}
