/**
 * Pulsar's view of the canonical message model.
 *
 * The property keys are a contract with internal/driver/pulsar/message_read.go.
 *
 * The thing that shapes this page is that Pulsar has no tag. What RocketMQ
 * puts in one, a Pulsar producer puts in a property - so the Tags column is
 * always empty and the filter that replaces it is "property name=value". The
 * board never draws a tag field, rather than drawing an empty one.
 *
 * The other is the message id. Pulsar's is ledger:entry:partition, printed the
 * way its own tooling prints it so an id copied out of this app can be pasted
 * into pulsar-admin. QueueOffset carries the entry id for ordering and display
 * only - the ledger is the other half, so nothing reconstructs an id from it.
 */
import type { MessageItem } from "@bindings/model/models";

export const PropertyBatchIndex = "pulsar.batchIndex";
export const PropertyProducer = "pulsar.producer";
export const PropertyOrderingKey = "pulsar.orderingKey";
export const PropertyEventTime = "pulsar.eventTime";
export const PropertyRedeliveryCount = "pulsar.redeliveryCount";

/** The keys the driver adds, which are not the producer's own. */
const DRIVER_PROPERTIES = new Set<string>([
  PropertyBatchIndex,
  PropertyProducer,
  PropertyOrderingKey,
  PropertyEventTime,
  PropertyRedeliveryCount,
]);

function property(message: MessageItem, key: string): string {
  return message.properties?.[key] ?? "";
}

export const producerName = (message: MessageItem): string =>
  property(message, PropertyProducer);
export const orderingKey = (message: MessageItem): string =>
  property(message, PropertyOrderingKey);
export const eventTime = (message: MessageItem): string =>
  property(message, PropertyEventTime);

/**
 * How many times this message has been redelivered.
 *
 * A message going round repeatedly is one about to be dead-lettered, which is
 * the single most useful thing on a browse of a topic somebody is debugging.
 */
export function redeliveryCount(message: MessageItem): number {
  const raw = property(message, PropertyRedeliveryCount);
  if (raw === "") return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * The producer's own properties, without the ones the driver added.
 *
 * Separating them matters: the driver's are facts about delivery and the
 * producer's are the application's own data, and a panel that mixed them would
 * show "pulsar.batchIndex" as something the application set.
 */
export function producerProperties(message: MessageItem): [string, string][] {
  return Object.entries(message.properties ?? {})
    .filter(([key]) => !DRIVER_PROPERTIES.has(key))
    .map(([key, value]) => [key, value ?? ""] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
}

/**
 * A "name=value" property filter, or the reason it cannot be used.
 *
 * A bare name is legal and means "carries this at all", which is a different
 * and useful question from matching a value.
 */
export function parsePropertyFilter(
  raw: string,
  t: (key: string) => string,
): { filter: string } | { error: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const [name] = trimmed.split("=");
  if ((name ?? "").trim() === "") {
    return { error: t("board.messages.pulsar.propertyNameRequired") };
  }
  return { filter: trimmed };
}
