/**
 * NATS's view of a canonical message.
 *
 * The canonical shape is RocketMQ's, and two of its fields are borrowed rather
 * than left empty - which is a decision worth reading before using them.
 *
 * `tags` carries the subject. A RocketMQ tag and a NATS subject are the same
 * idea: the routing label inside a destination. Leaving that column blank
 * would hide the single most important thing about a NATS message.
 *
 * `queueOffset` and `messageId` both carry the stream sequence, because that
 * is the only handle JetStream gives a message - there is no broker-assigned
 * identifier of any other kind.
 *
 * The filter keys are a contract with internal/driver/nats/message.go.
 */
import type { MessageItem } from "@bindings/model/models";

export const FilterSubject = "subject";
export const FilterStartSeq = "startSeq";
export const FilterHeaderName = "headerName";
export const FilterHeaderValue = "headerValue";

/** The subject the message was published on. */
export const subjectOf = (message: MessageItem): string => message.tags;

/** The stream sequence, which is how the message is addressed. */
export const sequenceOf = (message: MessageItem): number => message.queueOffset;

/** Which stream holds it. */
export const streamOf = (message: MessageItem): string => message.topic;

/**
 * The deduplication id the publisher set, if any.
 *
 * Nats-Msg-Id is not an address: the server keeps it only for the stream's
 * duplicate window and indexes nothing by it. It is shown because it is often
 * the application's own identifier, which is what somebody is actually
 * searching for - but a lookup takes the sequence.
 */
export function deduplicationId(message: MessageItem): string | null {
  const value = message.keys?.trim();
  return value == null || value === "" ? null : value;
}

/**
 * The headers, with the ones the server sets for itself left out.
 *
 * Nats-Msg-Id already has its own row, and the Nats-Expected-* headers are
 * publish preconditions rather than anything the message carries - showing
 * them beside an application's own headers would suggest they mean something
 * to whoever receives it.
 */
export function headers(message: MessageItem): [string, string][] {
  const properties = message.properties ?? {};
  return Object.entries(properties)
    .filter(([name, value]) => value != null && !isServerHeader(name))
    .map(([name, value]) => [name, value as string] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
}

function isServerHeader(name: string): boolean {
  return name === "Nats-Msg-Id" || name.startsWith("Nats-Expected-");
}

/** When the server stored it. */
export const storedAt = (message: MessageItem): string => message.storeTime;

/** The body, and whether there is one at all. */
export const bodyOf = (message: MessageItem): string => message.body;

/**
 * Whether the message carries no payload.
 *
 * An empty body is ordinary in NATS rather than a fault - a subject alone is a
 * signal, and request/reply uses empty messages routinely - so the board says
 * so instead of drawing an empty panel that reads as a failed load.
 */
export const isEmpty = (message: MessageItem): boolean => message.body === "";
