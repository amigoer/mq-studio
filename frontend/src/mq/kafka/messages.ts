/**
 * Kafka's view of a canonical message.
 *
 * The keys are a contract with internal/driver/kafka/record_read.go.
 *
 * A Kafka record has no id of its own. What identifies it is where it sits -
 * topic, partition, offset - and that triple is stable until the record ages
 * out, which is why this driver can answer "read that one again" where RabbitMQ
 * cannot.
 */
import type { MessageItem } from "@bindings/model/models";

/** Filter keys the board sends with a query. */
export const FilterPartition = "partition";
export const FilterMode = "mode";
export const FilterStartOffset = "startOffset";

/** How a read chooses where to start. */
export type ReadMode = "latest" | "offset" | "time" | "key";

/**
 * The marker the driver uses for a record written with no key at all.
 *
 * Kafka picks a partition from the key, so a record with none is spread across
 * partitions while one with an empty key is pinned like any other. The two
 * must not render alike, and no real key can collide with this because it
 * starts with a NUL.
 */
const NULL_KEY = "\u0000__mqs_null_key";

export const hasKey = (record: MessageItem): boolean => record.keys !== NULL_KEY;
export const keyOf = (record: MessageItem): string => (hasKey(record) ? record.keys : "");

export const partitionOf = (record: MessageItem): number => record.queueId;
export const offsetOf = (record: MessageItem): number => record.queueOffset;

/** Headers, which is what Kafka calls the canonical properties map. */
export const headersOf = (record: MessageItem): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(record.properties ?? {})) {
    if (value != null) headers[key] = value;
  }
  return headers;
};

export const headerCount = (record: MessageItem): number =>
  Object.keys(record.properties ?? {}).length;

/**
 * How a value should be shown.
 *
 * Kafka records carry bytes and nothing about what is in them - there is no
 * content type anywhere in the protocol - so this is a guess, and the board
 * labels it as one rather than presenting it as the record's own declaration.
 */
export type ValueShape = "json" | "text" | "binary" | "empty";

export function shapeOf(value: string): ValueShape {
  if (value === "") return "empty";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // It looked like JSON and is not, which is worth showing as text rather
      // than as a parse failure: the bytes are what they are.
      return "text";
    }
  }
  // A control character other than the usual whitespace means these are not
  // characters at all - most often Avro or protobuf, which this app does not
  // decode and must not pretend to.
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value) ? "binary" : "text";
}

/** Pretty-prints a value the board decided is JSON, and leaves the rest alone. */
export function formatValue(value: string): string {
  if (shapeOf(value) !== "json") return value;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** A tombstone: a record with a key and no value, which compaction deletes by. */
export const isTombstone = (record: MessageItem): boolean =>
  hasKey(record) && record.body === "";
