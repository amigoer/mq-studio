/**
 * Pulsar's view of the canonical subscription model.
 *
 * The keys are a contract with internal/driver/pulsar/subscription.go.
 *
 * The idea that shapes this page is that a subscription belongs to a topic and
 * is named only within it: two topics can each have one called "shared" and
 * they are unrelated. So the topic is part of a subscription's identity here
 * and travels in the ref, which is why every action on this page carries both.
 */
import type { Subscription } from "@bindings/model/models";
import {
  AttrSubscriptionActiveConsumer,
  AttrSubscriptionBacklogBytes,
  AttrSubscriptionBlocked,
  AttrSubscriptionDelayed,
  AttrSubscriptionDurable,
  AttrSubscriptionRedeliverRate,
  AttrSubscriptionTopic,
  AttrSubscriptionType,
  AttrSubscriptionUnacked,
  attr,
  count,
} from "./attributes";

/**
 * The four ways a Pulsar subscription can dispatch.
 *
 * Reported, never edited: the type is decided by the consumers that attach to
 * the subscription, not stored as configuration, so there is no admin call to
 * change it and no form that should offer to.
 */
export const SubscriptionType = {
  Exclusive: "Exclusive",
  Shared: "Shared",
  Failover: "Failover",
  KeyShared: "Key_Shared",
} as const;

/** Where a newly created subscription starts reading. */
export const StartAt = { Earliest: "earliest", Latest: "latest" } as const;
export type StartAtValue = (typeof StartAt)[keyof typeof StartAt];

/** The topic this subscription belongs to, which is half its identity. */
export const topicOf = (subscription: Subscription): string =>
  subscription.ref.namespace || attr(subscription, AttrSubscriptionTopic);

/** The short topic name, for a column that already shows the namespace. */
export function shortTopicOf(subscription: Subscription): string {
  const url = topicOf(subscription);
  const parts = url.split("/");
  return parts.length > 0 ? (parts[parts.length - 1] ?? url) : url;
}

export const subscriptionType = (subscription: Subscription): string =>
  attr(subscription, AttrSubscriptionType);

/**
 * Whether the broker has stopped delivering to this subscription.
 *
 * It is not a deep backlog and must not be drawn as one: past the unacked
 * limit the broker stops dispatching entirely, which looks identical to a slow
 * consumer from the backlog alone and is fixed somewhere completely different.
 */
export const isBlocked = (subscription: Subscription): boolean =>
  attr(subscription, AttrSubscriptionBlocked) === "true";

/**
 * Whether the cursor is one the broker persists.
 *
 * A non-durable subscription is a reader's own position and disappears when it
 * disconnects, so a reset aimed at one has nothing to move.
 */
export const isDurable = (subscription: Subscription): boolean =>
  attr(subscription, AttrSubscriptionDurable) !== "false";

export const unackedCount = (subscription: Subscription): number | null =>
  count(subscription, AttrSubscriptionUnacked);

/**
 * Messages scheduled for later.
 *
 * Counted inside the backlog and nobody's fault, so a page that could not tell
 * them apart from an unread backlog would raise an alarm about a consumer that
 * is perfectly healthy.
 */
export const delayedCount = (subscription: Subscription): number | null =>
  count(subscription, AttrSubscriptionDelayed);

export const backlogBytes = (subscription: Subscription): number | null =>
  count(subscription, AttrSubscriptionBacklogBytes);

/** How fast messages are going round again, which is what a failing consumer
 * looks like from the broker's side. */
export const redeliverRate = (subscription: Subscription): number | null =>
  count(subscription, AttrSubscriptionRedeliverRate);

/** On a Failover subscription, the one consumer actually receiving. */
export const activeConsumer = (subscription: Subscription): string =>
  attr(subscription, AttrSubscriptionActiveConsumer);

/**
 * Whether a subscription name the form collected can be created.
 *
 * Pulsar puts the name straight into a URL path, so a slash would address a
 * different subscription and a blank one would address the topic itself.
 */
export function validateSubscriptionName(
  name: string,
  t: (key: string) => string,
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return t("board.consumers.pulsar.nameRequired");
  if (/[\s/]/.test(trimmed)) return t("board.consumers.pulsar.nameInvalid");
  return null;
}
