/**
 * The send console's form, as data.
 *
 * Separate from the board because these are the decisions worth testing - what
 * an empty field means, how a header line is read, what the form refuses - and
 * the board itself reaches the Wails runtime at import time.
 */
import type { PublishInput } from "@/api/rabbitmq";

/** Where the message is addressed: a queue by name, or through an exchange. */
export type Target = "queue" | "exchange";

export const CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "application/octet-stream",
] as const;

export interface PublishForm {
  target: Target;
  queue: string;
  exchange: string;
  routingKey: string;
  body: string;
  persistent: boolean;
  mandatory: boolean;
  headers: string;
  contentType: string;
  correlationId: string;
  replyTo: string;
  messageId: string;
  type: string;
  expiration: string;
  priority: string;
  count: string;
}

export function emptyPublishForm(): PublishForm {
  return {
    target: "queue",
    queue: "",
    exchange: "",
    routingKey: "",
    body: "",
    // Both on by default, because both failures are silent otherwise: a
    // transient message vanishes on a restart, and an unroutable one is
    // dropped and still confirmed.
    persistent: true,
    mandatory: true,
    headers: "",
    contentType: "application/json",
    correlationId: "",
    replyTo: "",
    messageId: "",
    type: "",
    expiration: "",
    priority: "0",
    count: "1",
  };
}

/** Reads the header field: one `name=value` per line. */
export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const [name, ...rest] = line.split("=");
    // A header value may itself contain an equals sign, so only the first
    // splits. A line with no equals sign at all is not a header.
    if (name != null && name.trim() !== "" && rest.length > 0) {
      headers[name.trim()] = rest.join("=").trim();
    }
  }
  return headers;
}

export function toPublishInput(form: PublishForm, vhost: string): PublishInput {
  const count = Number.parseInt(form.count.trim(), 10);
  const priority = Number.parseInt(form.priority.trim(), 10);
  return {
    vhost,
    // Addressing a queue is publishing to the default exchange with the
    // queue's name as the routing key. That is how AMQP works rather than a
    // shortcut, so the form says it explicitly.
    exchange: form.target === "queue" ? "" : form.exchange.trim(),
    routingKey: form.target === "queue" ? form.queue.trim() : form.routingKey.trim(),
    body: form.body,
    persistent: form.persistent,
    mandatory: form.mandatory,
    headers: parseHeaders(form.headers),
    contentType: form.contentType,
    correlationId: form.correlationId.trim(),
    replyTo: form.replyTo.trim(),
    messageId: form.messageId.trim(),
    type: form.type.trim(),
    appId: "",
    expiration: form.expiration.trim(),
    priority: Number.isNaN(priority) ? 0 : priority,
    count: Number.isNaN(count) || count <= 0 ? 1 : count,
  };
}

export function validatePublish(
  form: PublishForm,
  t: (key: string) => string,
): string | null {
  if (form.target === "queue" && form.queue.trim() === "") {
    return t("board.producer.rabbitmq.queueRequired");
  }
  if (form.target === "exchange" && form.exchange.trim() === "") {
    return t("board.producer.rabbitmq.exchangeRequired");
  }
  if (form.body === "") return t("board.producer.rabbitmq.bodyRequired");
  const count = Number.parseInt(form.count.trim(), 10);
  if (Number.isNaN(count) || count < 1 || count > 1000) {
    return t("board.producer.rabbitmq.countRange");
  }
  return null;
}
