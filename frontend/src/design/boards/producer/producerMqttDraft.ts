/**
 * What the MQTT send console collects, and what it will not send.
 *
 * It lives beside the board rather than inside it because these rules are the
 * part worth testing, and a component module drags the whole shell in with it.
 * The same reason connectionDraft.ts sits beside ConnectionForms.tsx.
 */
import type { MQTTPublishInput } from "@/api/mqtt";

export interface MqttSendDraft {
  topic: string;
  payload: string;
  /** "0" | "1" | "2", as a string because it comes from a select. */
  qos: string;
  retain: boolean;
  count: string;
  /** Everything below is MQTT 5.0 only. */
  contentType: string;
  responseTopic: string;
  correlationData: string;
  /** Seconds. Blank means the broker's own default. */
  messageExpiry: string;
  /** "name=value" per line, the same shape Kafka's headers box uses. */
  userProperties: string;
}

export function emptyMqttSendDraft(): MqttSendDraft {
  return {
    topic: "",
    payload: "",
    // QoS 1 rather than 0, because the console's user is watching for an
    // answer: at QoS 0 nothing is acknowledged, so a wrong topic and a working
    // one look identical.
    qos: "1",
    retain: false,
    count: "1",
    contentType: "",
    responseTopic: "",
    correlationData: "",
    messageExpiry: "",
    userProperties: "",
  };
}

/** The two subscription wildcards, which are never valid in a topic name. */
export function hasWildcard(topic: string): boolean {
  return topic.includes("+") || topic.includes("#");
}

/**
 * Parses the user-properties box.
 *
 * Returns null on a line that is not "name=value", so the console can refuse
 * the send rather than drop the line: a property that vanished in transit is
 * found by whoever debugs the consumer, not here.
 */
export function parseUserProperties(raw: string): Record<string, string> | null {
  const properties: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) return null;
    properties[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
  }
  return properties;
}

/**
 * Why the count is capped here as well as in the driver.
 *
 * The driver refuses more than a thousand, and reaching that refusal means a
 * round trip and an error dialog. Catching it on the form says the same thing
 * without sending anything.
 */
export const MAX_COUNT = 1000;

/**
 * Validates a draft, returning an i18n key suffix rather than a sentence.
 *
 * `protocol5` says whether the connection can carry the 5.0 properties at all.
 * The driver refuses them on a 3.1.1 connection - dropping them silently would
 * report success for a message that arrived without them - and refusing here
 * as well means the console says so before the send rather than after.
 */
export function validateMqttSendDraft(draft: MqttSendDraft, protocol5: boolean): string | null {
  if (draft.topic.trim() === "") return "topicRequired";
  if (hasWildcard(draft.topic)) return "topicWildcard";

  const count = Number.parseInt(draft.count, 10);
  if (Number.isNaN(count) || count < 1 || count > MAX_COUNT) return "countInvalid";

  if (draft.messageExpiry.trim() !== "") {
    const expiry = Number.parseInt(draft.messageExpiry, 10);
    if (Number.isNaN(expiry) || expiry < 0) return "expiryInvalid";
  }
  if (parseUserProperties(draft.userProperties) == null) return "propertyLine";

  if (!protocol5 && usesFiveProperties(draft)) return "needsFive";
  return null;
}

/** True when the draft sets anything only MQTT 5.0 can carry. */
export function usesFiveProperties(draft: MqttSendDraft): boolean {
  return (
    draft.contentType.trim() !== "" ||
    draft.responseTopic.trim() !== "" ||
    draft.correlationData.trim() !== "" ||
    draft.messageExpiry.trim() !== "" ||
    draft.userProperties.trim() !== ""
  );
}

/** The draft as the bridge takes it. */
export function toMqttPublishInput(draft: MqttSendDraft, protocol5: boolean): MQTTPublishInput {
  const expiry = Number.parseInt(draft.messageExpiry, 10);
  return {
    topic: draft.topic.trim(),
    payload: draft.payload,
    qos: Number.parseInt(draft.qos, 10),
    retain: draft.retain,
    count: Number.parseInt(draft.count, 10),
    // A 3.1.1 connection sends none of these. They are cleared here rather
    // than left for the driver to refuse, so a form that still has an old
    // value in a hidden field cannot fail a send the user cannot see.
    contentType: protocol5 ? draft.contentType.trim() : "",
    responseTopic: protocol5 ? draft.responseTopic.trim() : "",
    correlationData: protocol5 ? draft.correlationData.trim() : "",
    messageExpiry: protocol5 && !Number.isNaN(expiry) ? expiry : 0,
    userProperties: protocol5 ? (parseUserProperties(draft.userProperties) ?? {}) : {},
  };
}
