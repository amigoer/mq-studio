/**
 * RabbitMQ's view of a canonical destination.
 *
 * The keys are a contract with internal/driver/rabbitmq/destination.go.
 */
import type { Destination } from "@bindings/model/models";
import { DEFAULT_EXCHANGE } from "./routing";

const AttrDurable = "durable";
const AttrAutoDelete = "autoDelete";
const AttrExclusive = "exclusive";
const AttrQueueType = "queueType";
const AttrNode = "node";
const AttrState = "state";
const AttrReady = "messagesReady";
const AttrUnacked = "messagesUnacknowledged";
const AttrMemory = "memory";
const AttrMessageBytes = "messageBytes";
const AttrPolicy = "policy";
const AttrLeader = "leader";
const AttrMembers = "members";
const AttrOnline = "onlineMembers";
const AttrUtilisation = "consumerUtilisation";
const AttrArguments = "arguments";
const AttrExchangeType = "exchangeType";

function attr(destination: Destination, key: string): string {
  return destination.attributes?.[key] ?? "";
}

function count(destination: Destination, key: string): number {
  const value = Number.parseInt(attr(destination, key), 10);
  return Number.isNaN(value) ? 0 : value;
}

export const queueName = (destination: Destination): string =>
  destination.ref.name;
export const vhost = (destination: Destination): string =>
  destination.ref.namespace;
export const durable = (destination: Destination): boolean =>
  attr(destination, AttrDurable) === "true";
export const autoDelete = (destination: Destination): boolean =>
  attr(destination, AttrAutoDelete) === "true";
export const exclusive = (destination: Destination): boolean =>
  attr(destination, AttrExclusive) === "true";
export const queueType = (destination: Destination): string =>
  attr(destination, AttrQueueType) || "classic";
export const node = (destination: Destination): string =>
  attr(destination, AttrNode);
export const state = (destination: Destination): string =>
  attr(destination, AttrState);
export const exchangeType = (destination: Destination): string =>
  attr(destination, AttrExchangeType);

/**
 * The two halves of a queue's depth.
 *
 * RabbitMQ splits what is waiting from what has been delivered and not yet
 * acknowledged, and the split is what an operator acts on: a growing unacked
 * count means consumers are attached but not keeping up, which reads nothing
 * like the same number sitting in ready.
 */
export const messagesReady = (destination: Destination): number =>
  count(destination, AttrReady);
export const messagesUnacknowledged = (destination: Destination): number =>
  count(destination, AttrUnacked);

export const memoryBytes = (destination: Destination): number =>
  count(destination, AttrMemory);
export const messageBytes = (destination: Destination): number =>
  count(destination, AttrMessageBytes);

/** The policy the broker says this queue matched, or "" for none. */
export const policy = (destination: Destination): string =>
  attr(destination, AttrPolicy);

/**
 * Replication, which only quorum and stream queues have.
 *
 * A classic queue lives on one node and the driver leaves these absent rather
 * than sending an empty list, because "replicated nowhere" and "not a
 * replicated queue" are different things.
 */
export const leader = (destination: Destination): string =>
  attr(destination, AttrLeader);

export function members(destination: Destination): string[] {
  const raw = attr(destination, AttrMembers);
  return raw === "" ? [] : raw.split(",");
}

export function onlineMembers(destination: Destination): string[] {
  const raw = attr(destination, AttrOnline);
  return raw === "" ? [] : raw.split(",");
}

/**
 * How busy the consumers are, 0 to 1, or null when there are none.
 *
 * The driver omits it for an unconsumed queue on purpose: the broker reports
 * zero there, which reads as "the consumers are idle" rather than "there are
 * no consumers".
 */
export function consumerUtilisation(destination: Destination): number | null {
  const raw = attr(destination, AttrUtilisation);
  if (raw === "") return null;
  const value = Number.parseFloat(raw);
  return Number.isNaN(value) ? null : value;
}

/**
 * The arguments the queue was declared with.
 *
 * They cross as JSON rather than as a flat string map because the types carry
 * meaning: x-max-length is a number, x-overflow a string, and a header
 * argument can be a nested table.
 */
export function argumentsOf(destination: Destination): Record<string, unknown> {
  const raw = attr(destination, AttrArguments);
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Argument names the UI labels rather than printing raw. */
export const ARG_MESSAGE_TTL = "x-message-ttl";
export const ARG_EXPIRES = "x-expires";
export const ARG_DLX = "x-dead-letter-exchange";
export const ARG_DLX_ROUTING_KEY = "x-dead-letter-routing-key";
export const ARG_MAX_LENGTH = "x-max-length";
export const ARG_MAX_LENGTH_BYTES = "x-max-length-bytes";
export const ARG_OVERFLOW = "x-overflow";
export const ARG_MAX_PRIORITY = "x-max-priority";
export const ARG_SINGLE_ACTIVE_CONSUMER = "x-single-active-consumer";
export const ARG_QUEUE_TYPE = "x-queue-type";

/**
 * The short tags a queue's row shows, from what it was actually declared with.
 *
 * x-queue-type is deliberately absent: the type has its own column, and
 * repeating it as a tag would spend the row's limited width saying the same
 * thing twice.
 */
export function featureTags(destination: Destination): string[] {
  const args = argumentsOf(destination);
  const tags: string[] = [];
  if (args[ARG_DLX] != null) tags.push("DLX");
  if (args[ARG_MESSAGE_TTL] != null) tags.push("TTL");
  if (args[ARG_EXPIRES] != null) tags.push("expires");
  if (args[ARG_MAX_LENGTH] != null || args[ARG_MAX_LENGTH_BYTES] != null) tags.push("max-length");
  if (args[ARG_MAX_PRIORITY] != null) tags.push("priority");
  if (args[ARG_SINGLE_ACTIVE_CONSUMER] === true) tags.push("single-active");
  if (exclusive(destination)) tags.push("exclusive");
  if (autoDelete(destination)) tags.push("auto-delete");
  if (!durable(destination)) tags.push("transient");
  return tags;
}

/** Exchanges. An exchange travels as a Destination: it is named, published to,
 * and has a rate - what it does not have is a depth, which is why that field
 * carries the unknown sentinel. */
const AttrInternal = "internal";

export const internal = (destination: Destination): boolean =>
  attr(destination, AttrInternal) === "true";

export const exchangeLabel = (destination: Destination): string =>
  destination.ref.name === "" ? DEFAULT_EXCHANGE : destination.ref.name;

/** Where an exchange sends what it could not route, or "" for nowhere. */
export function alternateExchange(destination: Destination): string {
  const value = argumentsOf(destination)["alternate-exchange"];
  return typeof value === "string" ? value : "";
}

/**
 * The tags an exchange's row shows.
 *
 * Internal is the one that changes how a reader should treat the row: an
 * internal exchange refuses direct publishes and exists only as a hop between
 * other exchanges.
 */
export function exchangeTags(destination: Destination): string[] {
  const tags: string[] = [];
  if (internal(destination)) tags.push("internal");
  if (!durable(destination)) tags.push("transient");
  if (autoDelete(destination)) tags.push("auto-delete");
  if (alternateExchange(destination) !== "") tags.push("AE");
  return tags;
}
