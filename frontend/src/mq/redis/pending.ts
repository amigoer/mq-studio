/**
 * Redis's pending entries, as the page reads them.
 *
 * A pending entry is a delivery record rather than a message: an id, who was
 * handed it, how long ago and how many times. The entry's own contents are a
 * separate read, which is why nothing here reaches for them.
 */
import type { GroupConsumer, PendingEntry, PendingSummary } from "@bindings/model/models";

/** A key unique across streams and groups, for selection in one table. */
export const pendingKey = (entry: PendingEntry): string =>
  `${entry.ref.namespace} ${entry.ref.name} ${entry.id}`;

export const entryStream = (entry: PendingEntry): string => entry.ref.namespace;
export const entryGroup = (entry: PendingEntry): string => entry.ref.name;

/**
 * How long an entry has been sitting with nobody finishing it.
 *
 * This is the column an operator sorts by. An entry idle for hours is one
 * nothing is coming back for; one idle for a second is work in flight.
 */
export const idleMs = (entry: PendingEntry): number => entry.idleMs;

/**
 * How many times the entry has been handed out.
 *
 * Above one means something claimed it or a consumer restarted. Climbing means
 * an entry that keeps being retried and keeps failing, which is the closest
 * thing Redis has to a poison message - and unlike a dead letter, nothing
 * moves it anywhere.
 */
export const deliveries = (entry: PendingEntry): number => entry.deliveries;

/** How long since a consumer last read anything. */
export const consumerIdleMs = (consumer: GroupConsumer): number => consumer.idleMs;

/**
 * How long since a consumer did anything at all, or null on a server that does
 * not report it.
 *
 * Redis 7.2 and later. It is not the same as idle - a consumer polling an
 * empty stream is idle and not inactive - so reading the wrong one would call
 * a busy consumer dead. An older server reports nothing, and that is a
 * different fact from "active a moment ago".
 */
export function consumerInactiveMs(consumer: GroupConsumer): number | null {
  return consumer.inactiveMs > 0 ? consumer.inactiveMs : null;
}

/**
 * What a consumer looks like it is doing.
 *
 * "abandoned" is the state the page exists to surface: entries owed to a
 * consumer that has not read anything for a long time. Nothing is coming back
 * for them on its own, and until something claims them they are simply stuck.
 */
export type ConsumerHealth = "working" | "abandoned" | "idle";

/** How long a consumer has to be quiet, while holding work, to look abandoned. */
export const ABANDONED_AFTER_MS = 60_000;

export function consumerHealth(
  consumer: GroupConsumer,
  abandonedAfterMs = ABANDONED_AFTER_MS,
): ConsumerHealth {
  if (consumer.pending === 0) return "idle";
  return consumer.idleMs >= abandonedAfterMs ? "abandoned" : "working";
}

/** How many entries the group is owed in total. */
export const pendingCount = (summary: PendingSummary): number => summary.count;

/**
 * The oldest pending id, or null when nothing is owed.
 *
 * Null rather than Redis's 0-0: an empty list has no oldest entry, and an id
 * on the page for a list that has none reads as a real entry.
 */
export const oldestPendingId = (summary: PendingSummary): string | null =>
  summary.minId === "" ? null : summary.minId;

export const newestPendingId = (summary: PendingSummary): string | null =>
  summary.maxId === "" ? null : summary.maxId;

/**
 * Whether one consumer is holding most of what the group is owed.
 *
 * It is the distinction the summary exists for: a single dead consumer and a
 * group that is generally behind look the same in the total, and need
 * completely different things done about them.
 */
export function dominantConsumer(
  summary: PendingSummary,
  share = 0.6,
): { consumer: string; count: number } | null {
  if (summary.count === 0) return null;
  const top = summary.perConsumer?.[0];
  if (top == null) return null;
  return top.count / summary.count >= share ? { consumer: top.consumer, count: top.count } : null;
}

/**
 * An idle time, in the units a reader actually thinks in.
 *
 * Milliseconds are what the server reports and what the filter takes, but a
 * column of seven-digit numbers is unreadable, and the whole point of the
 * column is that a glance separates work in flight from work that is stuck.
 */
export function formatIdle(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
