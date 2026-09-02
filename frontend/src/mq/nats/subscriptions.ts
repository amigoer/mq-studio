/**
 * NATS's view of a canonical subscription.
 *
 * The keys are a contract with internal/driver/nats/consumer.go.
 *
 * A JetStream consumer is named inside its stream, so the reference carries
 * both halves and every reader here needs both to address one. Two streams may
 * each have a "worker" and they are not the same object.
 */
import type { Subscription } from "@bindings/model/models";

const AttrDurable = "durable";
const AttrDeliverPolicy = "deliverPolicy";
const AttrAckPolicy = "ackPolicy";
const AttrAckWait = "ackWait";
const AttrMaxDeliver = "maxDeliver";
const AttrFilterSubject = "filterSubject";
const AttrReplayPolicy = "replayPolicy";
const AttrMaxAckPending = "maxAckPending";
const AttrMaxWaiting = "maxWaiting";
const AttrMaxBatch = "maxRequestBatch";
const AttrDeliverGroup = "deliverGroup";
const AttrDeliverTo = "deliverSubject";
const AttrAckPending = "ackPending";
const AttrRedelivered = "redelivered";
const AttrDeliveredSeq = "deliveredSeq";
const AttrAckFloorSeq = "ackFloorSeq";
const AttrConsumerKind = "consumerKind";
const AttrCreatedAt = "consumerCreated";
const AttrWaiting = "waitingRequests";
const AttrClusterName = "clusterName";
const AttrLeader = "leader";

/** The driver's marker for a figure the family does not report. */
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

export const consumerName = (subscription: Subscription): string => subscription.ref.name;

/**
 * The stream it reads. Half of the consumer's address, not a decoration.
 *
 * It comes from the reference rather than from the attribute the driver also
 * sets, because the reference is what every other call takes: reading it from
 * two places would let the two disagree.
 */
export const streamOf = (subscription: Subscription): string => subscription.ref.namespace;

/** How far behind this consumer is - not how much the stream holds. */
export const backlog = (subscription: Subscription): number => subscription.backlog;

/**
 * Push or pull, which decides what half the other fields mean.
 *
 * A pull consumer is asked for messages; a push one is given a subject and
 * sends to it unprompted. They are one object with one field set differently,
 * and almost every column below reads differently between them.
 */
export const kind = (subscription: Subscription): string | null =>
  attr(subscription, AttrConsumerKind);

export const isPush = (subscription: Subscription): boolean =>
  kind(subscription) === "push";

/**
 * How many clients are attached, or null where the server cannot say.
 *
 * Only a push consumer has an answer, and only yes or no: it delivers to one
 * subject and something either listens on it or does not. A pull consumer has
 * nobody to count - clients ask when they want messages and hold nothing open
 * in between - and reporting zero there would call a working consumer
 * unattended.
 */
export function members(subscription: Subscription): number | null {
  return subscription.members === UNKNOWN ? null : subscription.members;
}

/**
 * How many pull requests are parked waiting for something to arrive.
 *
 * Not a client count: one client may hold several. It is the only figure a
 * pull consumer offers about who is asking, which is why it is labelled for
 * what it is rather than shown in the members column.
 */
export const waitingRequests = (subscription: Subscription): number | null =>
  number(subscription, AttrWaiting);

/** Work handed out and not yet acknowledged. */
export const ackPending = (subscription: Subscription): number | null =>
  number(subscription, AttrAckPending);

/** Deliveries that had to be repeated, which means something is not finishing. */
export const redelivered = (subscription: Subscription): number | null =>
  number(subscription, AttrRedelivered);

/**
 * Where the consumer has got to, in stream sequences.
 *
 * Two numbers because they answer different questions: delivered is the
 * furthest the server has handed out, and the ack floor is the point below
 * which everything is settled. A gap between them is work in flight.
 */
export const deliveredSequence = (subscription: Subscription): number | null =>
  number(subscription, AttrDeliveredSeq);
export const ackFloorSequence = (subscription: Subscription): number | null =>
  number(subscription, AttrAckFloorSeq);

/**
 * Whether the consumer survives being unused.
 *
 * An ephemeral consumer is cleaned up when nothing is bound to it, taking its
 * position with it. That is a fact worth showing rather than an absent field.
 */
export const durableName = (subscription: Subscription): string | null =>
  attr(subscription, AttrDurable);
export const isDurable = (subscription: Subscription): boolean =>
  durableName(subscription) != null;

export const deliverPolicy = (subscription: Subscription): string | null =>
  attr(subscription, AttrDeliverPolicy);
export const ackPolicy = (subscription: Subscription): string | null =>
  attr(subscription, AttrAckPolicy);
export const replayPolicy = (subscription: Subscription): string | null =>
  attr(subscription, AttrReplayPolicy);
export const ackWait = (subscription: Subscription): string | null =>
  attr(subscription, AttrAckWait);
export const createdAt = (subscription: Subscription): string | null =>
  attr(subscription, AttrCreatedAt);

/**
 * How many times a message may be redelivered before the server gives up.
 *
 * -1 is unlimited, which comes back as null so a board can render the word.
 * The value matters more here than on most fields: when it is reached, the
 * message is not moved anywhere - JetStream has no dead-letter queue - it
 * simply stops being redelivered, and only an advisory says so.
 */
export function maxDeliver(subscription: Subscription): number | null {
  const value = number(subscription, AttrMaxDeliver);
  return value == null || value < 0 ? null : value;
}

export function maxAckPending(subscription: Subscription): number | null {
  const value = number(subscription, AttrMaxAckPending);
  return value == null || value < 0 ? null : value;
}

export const maxWaiting = (subscription: Subscription): number | null =>
  number(subscription, AttrMaxWaiting);
export const maxRequestBatch = (subscription: Subscription): number | null =>
  number(subscription, AttrMaxBatch);

/** What the consumer takes from the stream. Null means all of it. */
export function filterSubjects(subscription: Subscription): string[] {
  const raw = attr(subscription, AttrFilterSubject);
  if (raw == null) return [];
  return raw
    .split(",")
    .map((subject) => subject.trim())
    .filter((subject) => subject !== "");
}

/** Push-only: where the server sends, and which queue group shares the work. */
export const deliverSubject = (subscription: Subscription): string | null =>
  attr(subscription, AttrDeliverTo);
export const deliverGroup = (subscription: Subscription): string | null =>
  attr(subscription, AttrDeliverGroup);

/** Where the consumer's own state lives. Null on a single server. */
export const clusterName = (subscription: Subscription): string | null =>
  attr(subscription, AttrClusterName);
export const leader = (subscription: Subscription): string | null =>
  attr(subscription, AttrLeader);
