/**
 * The Pulsar send console's form, as pure functions.
 *
 * Separate from the component so the rules are testable without a DOM, and
 * because two of them are the kind that fail silently: a delay in the wrong
 * unit schedules a message for the wrong time, and a repeat count with a
 * slipped digit fills a production topic.
 *
 * The shape is Pulsar's own. There is no tag field, because the family has no
 * tag - a producer puts in a property what a RocketMQ one puts in a tag - and
 * no exchange or routing key, because those are AMQP.
 */
import type { PulsarPublishInput } from "@/api/pulsar";

export interface PulsarPublishForm {
  /** A full topic URL, which is how a Pulsar topic is addressed. */
  topic: string;
  key: string;
  orderingKey: string;
  body: string;
  /** Free-form "name=value" lines, one per property. */
  properties: string;
  /** Seconds, which is what the label says and what the driver takes. */
  delaySeconds: string;
  count: string;
}

export function emptyPublishForm(topic = ""): PulsarPublishForm {
  return {
    topic,
    key: "",
    orderingKey: "",
    body: "",
    properties: "",
    delaySeconds: "",
    count: "1",
  };
}

/** The cap the driver enforces, mirrored so the form can say so first. */
export const MAX_COUNT = 1000;

/**
 * Parses the "name=value" lines into properties.
 *
 * A line with no equals sign is a mistake worth naming rather than silently
 * dropping: somebody typing "stage paid" meant to set a property.
 */
export function parseProperties(
  raw: string,
): { properties: Record<string, string> } | { error: string } {
  const properties: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) return { error: trimmed };
    properties[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return { properties };
}

/** A whole number from a hand-typed field, or null. */
function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const value = Number.parseInt(trimmed, 10);
  if (Number.isNaN(value) || value < 0 || String(value) !== trimmed) return null;
  return value;
}

/**
 * The reason the form cannot be sent, or null.
 *
 * The count is checked against the driver's own cap here so the message names
 * the field, rather than arriving as a refusal from Go after the button was
 * pressed.
 */
export function validate(
  form: PulsarPublishForm,
  t: (key: string) => string,
): string | null {
  if (form.topic.trim() === "") return t("board.producer.pulsar.topicRequired");
  if (form.body === "") return t("board.producer.pulsar.bodyRequired");

  const properties = parseProperties(form.properties);
  if ("error" in properties) return t("board.producer.pulsar.propertyLineInvalid");

  if (wholeNumber(form.delaySeconds) == null) {
    return t("board.producer.pulsar.delayInvalid");
  }
  const count = wholeNumber(form.count);
  if (count == null || count < 1) return t("board.producer.pulsar.countInvalid");
  if (count > MAX_COUNT) return t("board.producer.pulsar.countTooLarge");
  return null;
}

/**
 * The request the form sends.
 *
 * The delay crosses the bridge in milliseconds because that is the unit a JSON
 * boundary carries without anybody having to remember one; the field is
 * labelled and typed in seconds, which is what an operator thinks in.
 */
export function toInput(form: PulsarPublishForm): PulsarPublishInput {
  const properties = parseProperties(form.properties);
  return {
    topic: form.topic.trim(),
    key: form.key.trim(),
    orderingKey: form.orderingKey.trim(),
    body: form.body,
    properties: "error" in properties ? {} : properties.properties,
    deliverAfterMs: (wholeNumber(form.delaySeconds) ?? 0) * 1000,
    // Left unset rather than stamped with now: an event time the operator did
    // not choose is a claim about when something happened.
    eventTimeMs: 0,
    count: wholeNumber(form.count) ?? 1,
  } as PulsarPublishInput;
}
