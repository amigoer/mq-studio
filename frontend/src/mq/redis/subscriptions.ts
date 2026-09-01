/**
 * Redis's view of a canonical subscription.
 *
 * The keys are a contract with internal/driver/redisstream/subscription.go.
 *
 * A consumer group belongs to one stream and its name is unique only within
 * that stream, so every reader here takes both halves of the reference. Two
 * streams may each hold a "settle-group" and they are unrelated objects.
 */
import type { Subscription } from "@bindings/model/models";

const AttrStream = "stream";
const AttrPending = "pending";
const AttrLastDeliveredID = "lastDeliveredId";
const AttrEntriesRead = "entriesRead";

/** The driver's marker for a figure the broker did not report. */
export const UNKNOWN = -1;

function attr(subscription: Subscription, key: string): string | null {
  const value = subscription.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(subscription: Subscription, key: string): number | null {
  const raw = attr(subscription, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export const groupName = (subscription: Subscription): string => subscription.ref.name;

/** The stream the group reads. It is the other half of the group's identity. */
export const groupStream = (subscription: Subscription): string =>
  subscription.ref.namespace || (attr(subscription, AttrStream) ?? "");

/** A key that is unique across streams, for a list and for selection. */
export const groupKey = (subscription: Subscription): string =>
  `${groupStream(subscription)} ${groupName(subscription)}`;

/** How many consumers are attached. */
export const consumerCount = (subscription: Subscription): number => subscription.members;

/** Entries handed out and not yet acknowledged, from XINFO GROUPS. */
export const pending = (subscription: Subscription): number | null =>
  number(subscription, AttrPending);

export const lastDeliveredId = (subscription: Subscription): string | null =>
  attr(subscription, AttrLastDeliveredID);

/**
 * How many entries the group has read over its life.
 *
 * Absent when Redis could not work the lag out - the two come and go together,
 * because deleting entries a group had not read makes both uncountable.
 */
export const entriesRead = (subscription: Subscription): number | null =>
  number(subscription, AttrEntriesRead);

/**
 * How far the group is behind the end of the stream, or null when Redis said
 * it could not tell.
 *
 * The distinction is the whole point. A zero means caught up; not knowing
 * happens once entries the group had not read were deleted, and rendering that
 * as a zero would report a group that is arbitrarily far behind as done.
 */
export function lag(subscription: Subscription): number | null {
  return subscription.backlog === UNKNOWN ? null : subscription.backlog;
}

/**
 * What an operator should look at first.
 *
 * "idle" and "stalled" are deliberately different. A group with nothing
 * attached and nothing pending is an application that is not running, which is
 * often exactly as intended. One with nothing attached and entries still
 * pending is work that was handed out and never acknowledged, and nothing is
 * coming back for it until something attaches or claims it.
 */
export type GroupHealth = "consuming" | "stalled" | "idle";

export function health(subscription: Subscription): GroupHealth {
  if (consumerCount(subscription) > 0) return "consuming";
  return (pending(subscription) ?? 0) > 0 ? "stalled" : "idle";
}
