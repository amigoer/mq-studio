/**
 * RabbitMQ's view of a canonical message.
 *
 * The keys are a contract with internal/driver/rabbitmq/message_browse.go.
 */
import type { MessageItem } from "@bindings/model/models";

/**
 * The filters a browse can narrow by.
 *
 * Not the canonical ones. RabbitMQ has no key index and no time index, so the
 * shared search form's fields have nothing to search; what it does have is the
 * routing key a message arrived with, its headers, and the payload itself.
 */
export const FILTER_ROUTING_KEY = "routingKey";
export const FILTER_HEADER = "header";
export const FILTER_BODY = "body";

const HEADER_PREFIX = "header.";

function property(message: MessageItem, key: string): string {
  return message.properties?.[key] ?? "";
}

export const exchange = (message: MessageItem): string => property(message, "exchange");
export const routingKey = (message: MessageItem): string => property(message, "routingKey");
export const contentType = (message: MessageItem): string => property(message, "contentType");
export const correlationId = (message: MessageItem): string =>
  property(message, "correlationId");
export const replyTo = (message: MessageItem): string => property(message, "replyTo");
export const expiration = (message: MessageItem): string => property(message, "expiration");
export const priority = (message: MessageItem): string => property(message, "priority");
export const appId = (message: MessageItem): string => property(message, "appId");

/** Whether the broker has handed this message out before. */
export const redelivered = (message: MessageItem): boolean =>
  property(message, "redelivered") === "true";

/**
 * Whether the message survives a broker restart.
 *
 * A transient message on a durable queue is still lost when the node goes
 * down, which surprises people often enough to be worth its own reading.
 */
export const persistent = (message: MessageItem): boolean =>
  property(message, "deliveryMode") === "persistent";

/** The application headers, without the prefix the driver namespaces them by. */
export function headers(message: MessageItem): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [key, value] of Object.entries(message.properties ?? {})) {
    if (key.startsWith(HEADER_PREFIX)) found[key.slice(HEADER_PREFIX.length)] = value ?? "";
  }
  return found;
}

/** The AMQP properties, which are the broker's own fields rather than headers. */
export function amqpProperties(message: MessageItem): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [key, value] of Object.entries(message.properties ?? {})) {
    if (!key.startsWith(HEADER_PREFIX)) found[key] = value ?? "";
  }
  return found;
}

/**
 * The x-death header, which is how a dead-lettered message carries its
 * history.
 *
 * RabbitMQ writes it as an array of tables, one per queue the message has died
 * in, and the driver flattens that to text. Reading the count and reason out
 * of it is what turns "this is in the dead-letter queue" into "this failed
 * four times on order.settle.q because the consumer rejected it".
 */
export function deathHeader(message: MessageItem): string {
  return headers(message)["x-death"] ?? "";
}

/**
 * The most useful single fact from x-death: how many times this has died.
 *
 * Returns null when the header is absent or unreadable, which the panel shows
 * as nothing rather than as zero - zero would claim the message has never
 * been dead-lettered, and that is a different thing from not knowing.
 */
export function deathCount(message: MessageItem): number | null {
  const raw = deathHeader(message);
  if (raw === "") return null;
  const match = /count=(\d+)/.exec(raw);
  if (match?.[1] == null) return null;
  const count = Number.parseInt(match[1], 10);
  return Number.isNaN(count) ? null : count;
}

/** The queue this message was in before it was dead-lettered, if it says. */
export function deathQueue(message: MessageItem): string {
  return /queue=([^,}\s]+)/.exec(deathHeader(message))?.[1] ?? "";
}

/** Why it was dead-lettered: rejected, expired, maxlen or delivery_limit. */
export function deathReason(message: MessageItem): string {
  return /reason=([^,}\s]+)/.exec(deathHeader(message))?.[1] ?? "";
}
