/**
 * RabbitMQ's view of a canonical destination.
 *
 * The keys are a contract with internal/driver/rabbitmq/destination.go.
 */
import type { Destination } from "@bindings/model/models";

const AttrDurable = "durable";
const AttrAutoDelete = "autoDelete";
const AttrExclusive = "exclusive";
const AttrQueueType = "queueType";
const AttrNode = "node";
const AttrState = "state";
const AttrReady = "messagesReady";
const AttrUnacked = "messagesUnacknowledged";
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
