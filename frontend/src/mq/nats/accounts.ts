/**
 * NATS's view of a canonical namespace.
 *
 * The keys are a contract with internal/driver/nats/account.go.
 *
 * An account is NATS's isolation boundary and its only one: two accounts on
 * the same server share no subjects, no streams and no limits, and every
 * connection belongs to exactly one. None of a vhost's furniture applies -
 * there is no queue type to default and nothing to trace - so the canonical
 * fields this reads are the name and the limits, and the rest arrives in the
 * attribute map.
 *
 * Message counts are UnknownMetric on every row rather than zero. NATS keeps
 * no account-wide message total anywhere: JetStream counts bytes per account
 * and messages per stream, and core NATS keeps nothing at all.
 */
import type { Namespace } from "@bindings/model/models";

const AttrSource = "readVia";
const AttrIsSystemAccount = "systemAccount";
const AttrJetStream = "jetstream";
const AttrServersReporting = "serversReporting";
const AttrConnections = "connections";
const AttrLeafNodes = "leafNodes";
const AttrSubscriptions = "subscriptions";
const AttrSlowConsumers = "slowConsumers";
const AttrInMsgs = "inMsgs";
const AttrInBytes = "inBytes";
const AttrOutMsgs = "outMsgs";
const AttrOutBytes = "outBytes";
const AttrJSMemory = "jetstreamMemory";
const AttrJSStorage = "jetstreamStorage";
const AttrAPITotal = "apiTotal";
const AttrAPIErrors = "apiErrors";

/** The limit keys the driver writes. */
const LimitMemory = "maxMemory";
const LimitStorage = "maxStorage";

function attr(account: Namespace, key: string): string | null {
  const value = account.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(account: Namespace, key: string): number | null {
  const raw = attr(account, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

/**
 * The system account, which is the one $SYS.REQ.* answers on.
 *
 * Worth marking because a list of names gives no other way to tell, and it is
 * the account whose credentials decide half of what this app can do.
 */
export const isSystemAccount = (account: Namespace): boolean =>
  attr(account, AttrIsSystemAccount) === "true";

/**
 * Whether the account may use JetStream.
 *
 * A server can have JetStream running and grant it to some accounts and not
 * others, so this is a property of the account rather than of the cluster.
 */
export const hasJetStream = (account: Namespace): boolean =>
  attr(account, AttrJetStream) === "true";

/** Which tier the figures came from: the system account, or monitoring. */
export const readVia = (account: Namespace): string | null => attr(account, AttrSource);

/**
 * How many servers contributed to the counts on this row.
 *
 * One through the monitoring endpoint whatever the size of the cluster, and
 * the counts are that server's share rather than the cluster's total. The page
 * says so, because a partial figure presented as a total is worse than none.
 */
export const serversReporting = (account: Namespace): number | null =>
  number(account, AttrServersReporting);

export const connections = (account: Namespace): number | null => number(account, AttrConnections);
export const leafNodes = (account: Namespace): number | null => number(account, AttrLeafNodes);
export const subscriptions = (account: Namespace): number | null =>
  number(account, AttrSubscriptions);
export const slowConsumers = (account: Namespace): number | null =>
  number(account, AttrSlowConsumers);

export const messagesIn = (account: Namespace): number | null => number(account, AttrInMsgs);
export const messagesOut = (account: Namespace): number | null => number(account, AttrOutMsgs);
export const bytesIn = (account: Namespace): number | null => number(account, AttrInBytes);
export const bytesOut = (account: Namespace): number | null => number(account, AttrOutBytes);

export const memoryUsed = (account: Namespace): number | null => number(account, AttrJSMemory);
export const storageUsed = (account: Namespace): number | null => number(account, AttrJSStorage);

export const apiRequests = (account: Namespace): number | null => number(account, AttrAPITotal);
export const apiErrors = (account: Namespace): number | null => number(account, AttrAPIErrors);

/**
 * A limit, or null where there is none.
 *
 * Absent means uncapped rather than zero, which is the distinction the model
 * exists to keep: an account granted JetStream with no allowance at all is a
 * real state and reads as a cap of zero.
 */
function limit(account: Namespace, key: string): number | null {
  const value = account.limits?.[key];
  return value == null ? null : value;
}

export const memoryLimit = (account: Namespace): number | null => limit(account, LimitMemory);
export const storageLimit = (account: Namespace): number | null => limit(account, LimitStorage);

/**
 * How full a meter is, or null where there is nothing to draw it against.
 *
 * A meter with no cap behind it can never move, so the page shows the figure
 * on its own instead of a bar that is always empty.
 */
export function usedPercent(used: number | null, cap: number | null): number | null {
  if (used == null || cap == null || cap <= 0) return null;
  return Math.min(100, Math.round((used / cap) * 100));
}
