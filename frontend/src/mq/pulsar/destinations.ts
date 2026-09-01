/**
 * Pulsar's view of the canonical destination model.
 *
 * The keys are a contract with internal/driver/pulsar/topic.go.
 *
 * The one that shapes the whole page is persistence. A Pulsar topic is
 * declared as persistent:// or non-persistent://, the scheme is part of every
 * address the driver builds, and a non-persistent topic keeps nothing at all -
 * a message nobody is connected to receive is dropped. So it is a column
 * rather than a detail, and a delete that guessed it would address a topic
 * that does not exist.
 */
import type { Destination } from "@bindings/model/models";
import {
  AttrTopicAverageMessageBytes,
  AttrTopicPersistent,
  AttrTopicProducers,
  AttrTopicStorageBytes,
  attr,
  count,
} from "./attributes";

/** Whether the topic was declared as persistent://. */
export const isPersistent = (topic: Destination): boolean =>
  attr(topic, AttrTopicPersistent) !== "false";

/**
 * What the topic occupies in BookKeeper.
 *
 * Not the same as the backlog: retention keeps acknowledged messages on disk,
 * so a topic every subscription has caught up with still has a size.
 */
export const storageBytes = (topic: Destination): number | null =>
  count(topic, AttrTopicStorageBytes);

export const producerCount = (topic: Destination): number | null =>
  count(topic, AttrTopicProducers);

export const averageMessageBytes = (topic: Destination): number | null =>
  count(topic, AttrTopicAverageMessageBytes);

/**
 * Whether this topic is partitioned, which is not the same as having one
 * partition.
 *
 * Pulsar's two shapes are different objects: a non-partitioned topic can never
 * become partitioned, and a partitioned one with a single partition is
 * addressed as name-partition-0 and can grow. The column has to tell them
 * apart because it decides what an operator can do next.
 */
export const isPartitioned = (topic: Destination): boolean => topic.partitions > 0;

/** The unknown sentinel the driver uses for a figure it did not read. */
const UNKNOWN = -1;

/** A figure the driver reported, or null when it did not. */
export function reported(value: number): number | null {
  return value === UNKNOWN ? null : value;
}

/** The tenant/namespace half of a topic's ref. */
export const namespaceOf = (topic: Destination): string => topic.ref.namespace;

/** The short name, which is what a list column shows. */
export const nameOf = (topic: Destination): string => topic.ref.name;

/** The address Pulsar's own tooling would use for this topic. */
export function topicURL(topic: Destination): string {
  const scheme = isPersistent(topic) ? "persistent" : "non-persistent";
  return `${scheme}://${namespaceOf(topic)}/${nameOf(topic)}`;
}

/**
 * Whether a topic name the form collected can be created.
 *
 * Pulsar's own restriction is narrow - the name must not be empty and cannot
 * contain the separators that would move it into another namespace. Catching
 * it here means the message names the field rather than arriving as a 412
 * quoting a URL.
 */
export function validateTopicName(
  name: string,
  t: (key: string) => string,
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return t("board.topics.pulsar.nameRequired");
  if (trimmed.includes("://")) return t("board.topics.pulsar.nameScheme");
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return t("board.topics.pulsar.nameSlash");
  }
  // A "-partition-N" suffix is how Pulsar addresses one partition of a
  // partitioned topic. Creating a topic with that name by hand produces one
  // that shadows a partition and is unreachable through its parent.
  if (/-partition-\d+$/.test(trimmed)) return t("board.topics.pulsar.namePartitionSuffix");
  return null;
}

/**
 * The partition count a create will send, or the reason it will not.
 *
 * Blank is 0, which is a non-partitioned topic - a real choice rather than a
 * missing value, and the one most topics want.
 */
export function parsePartitions(
  raw: string,
): { value: number } | { error: "invalid" } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: 0 };
  const value = Number.parseInt(trimmed, 10);
  if (Number.isNaN(value) || value < 0 || String(value) !== trimmed) {
    return { error: "invalid" };
  }
  return { value };
}
