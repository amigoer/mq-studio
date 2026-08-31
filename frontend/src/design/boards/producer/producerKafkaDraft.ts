/**
 * What the Kafka send console collects, and what it will not send.
 *
 * It lives beside the board rather than inside it because these rules are the
 * part worth testing, and a component module drags the whole shell in with it.
 * The same reason connectionDraft.ts sits beside ConnectionForms.tsx.
 */
import { parseConfigLines } from "@/design/boards/topics/TopicDialogKafka";

/** How many replicas must have the record before the cluster answers. */
export type KafkaAcks = "none" | "leader" | "all";

export interface KafkaSendDraft {
  topic: string;
  /** Empty lets the key decide the partition. */
  partition: string;
  /** Off sends a record with no key at all, which Kafka spreads. */
  withKey: boolean;
  key: string;
  value: string;
  headers: string;
  acks: KafkaAcks;
  count: string;
}

export function emptyKafkaSendDraft(): KafkaSendDraft {
  return {
    topic: "",
    partition: "",
    withKey: true,
    key: "",
    value: "",
    headers: "",
    acks: "all",
    count: "1",
  };
}

/**
 * Why the numeric fields are strings.
 *
 * A blank partition means "let the key decide", which is what ordering by key
 * depends on, and a number input would collapse that into partition zero.
 */
export function validateKafkaSendDraft(draft: KafkaSendDraft): string | null {
  if (draft.topic.trim() === "") return "topicRequired";
  if (draft.partition.trim() !== "") {
    const parsed = Number.parseInt(draft.partition, 10);
    if (Number.isNaN(parsed) || parsed < 0) return "partitionInvalid";
  }
  const count = Number.parseInt(draft.count, 10);
  if (Number.isNaN(count) || count < 1 || count > 10_000) return "countInvalid";
  if (parseConfigLines(draft.headers) == null) return "headerLine";
  return null;
}

/** The draft as the bridge takes it. */
export function toKafkaRecordInput(draft: KafkaSendDraft) {
  return {
    topic: draft.topic.trim(),
    partition: draft.partition.trim() === "" ? -1 : Number.parseInt(draft.partition, 10),
    hasKey: draft.withKey,
    // The key field keeps its text while the switch is off, and it must not
    // leak through: a record with no key is not one with the leftover key.
    key: draft.withKey ? draft.key : "",
    value: draft.value,
    headers: parseConfigLines(draft.headers) ?? {},
    // Zero lets the producer stamp it, and a topic set to LogAppendTime
    // overrides whatever the client sent anyway.
    timestamp: 0,
    acks: draft.acks,
    count: Number.parseInt(draft.count, 10) || 1,
  };
}
