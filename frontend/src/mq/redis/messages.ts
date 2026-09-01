/**
 * Redis's view of a canonical message.
 *
 * The keys are a contract with internal/driver/redisstream/message.go.
 *
 * A stream entry is a set of field/value pairs rather than a payload with
 * metadata attached, so the fields are the message: they arrive in Properties,
 * and the body is a JSON rendering of the whole entry rather than one field
 * the driver decided to call the payload.
 */
import type { MessageItem } from "@bindings/model/models";

/** The filter keys the driver understands. */
export const FILTER_FIELD = "field";
export const FILTER_CONTAINS = "contains";

/** The entry id, which is this family's stable, addressable message id. */
export const entryId = (message: MessageItem): string => message.messageId;

export const streamOf = (message: MessageItem): string => message.topic;

/**
 * When the entry was added, from the server's own clock.
 *
 * Not derived here: Redis generates the id from the clock, so the id's first
 * half is the timestamp rather than a guess at one.
 */
export const addedAt = (message: MessageItem): string => message.storeTime;
export const addedAtMs = (message: MessageItem): number => message.storeTimestamp;

/** One field of an entry. */
export interface EntryField {
  name: string;
  value: string;
}

/**
 * The entry's fields, in name order.
 *
 * The order they were written in is not recoverable - the client hands them
 * back as a map - so they are sorted, which is at least stable between reads.
 */
export function fields(message: MessageItem): EntryField[] {
  const properties = message.properties ?? {};
  return Object.keys(properties)
    .sort()
    .map((name) => ({ name, value: properties[name] ?? "" }));
}

export const fieldCount = (message: MessageItem): number => fields(message).length;

/**
 * A one-line preview of what an entry holds.
 *
 * The list has one column for contents and an entry may carry any number of
 * fields, so this is deliberately a summary and reads like one. What it must
 * not do is look like the whole entry: the detail panel is where every field
 * is shown in full.
 */
export function summary(message: MessageItem, limit = 3): string {
  const shown = fields(message);
  const head = shown
    .slice(0, limit)
    .map(({ name, value }) => `${name}=${value.length > 24 ? `${value.slice(0, 24)}…` : value}`)
    .join("  ");
  return shown.length > limit ? `${head}  +${shown.length - limit}` : head;
}

/**
 * The whole entry as the driver rendered it, for copying.
 *
 * It is a JSON object of every field, which is a faithful rendering rather
 * than a payload: Redis has no convention naming one field the body.
 */
export const asJson = (message: MessageItem): string => message.body;
