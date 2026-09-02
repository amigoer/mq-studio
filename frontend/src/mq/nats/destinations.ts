/**
 * NATS's view of a canonical destination.
 *
 * The keys are a contract with internal/driver/nats/attributes.go.
 *
 * The readers below return null rather than 0 or "" wherever the server
 * genuinely did not answer. A stream with no messages has no first message
 * time, and a stream on a single server has no replica state at all - both are
 * different from a zero, and a board that renders them the same tells the
 * reader something untrue about their cluster.
 */
import type { Destination } from "@bindings/model/models";

const AttrSubjects = "subjects";
const AttrRetention = "retention";
const AttrStorage = "storage";
const AttrDiscard = "discard";
const AttrReplicas = "replicas";
const AttrMaxMsgs = "maxMsgs";
const AttrMaxBytes = "maxBytes";
const AttrMaxAge = "maxAge";
const AttrMaxMsgSize = "maxMsgSize";
const AttrMaxMsgsPer = "maxMsgsPerSubject";
const AttrDuplicates = "duplicateWindow";
const AttrDescription = "description";
const AttrSealed = "sealed";
const AttrDenyDelete = "denyDelete";
const AttrDenyPurge = "denyPurge";
const AttrAllowRollup = "allowRollup";
const AttrCompression = "compression";
const AttrFirstSeq = "firstSeq";
const AttrLastSeq = "lastSeq";
const AttrFirstTime = "firstTime";
const AttrLastTime = "lastTime";
const AttrBytes = "bytes";
const AttrNumSubjects = "numSubjects";
const AttrNumDeleted = "numDeleted";
const AttrCreated = "created";
const AttrClusterName = "clusterName";
const AttrLeader = "leader";
const AttrReplicaState = "replicaState";
const AttrReplicasHealthy = "replicasHealthy";
const AttrMirrorOf = "mirrorOf";
const AttrSourceOf = "sourceOf";

function attr(destination: Destination, key: string): string | null {
  const value = destination.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(destination: Destination, key: string): number | null {
  const raw = attr(destination, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export const streamName = (destination: Destination): string => destination.ref.name;

/** How many messages the stream currently holds. Always answered. */
export const messages = (destination: Destination): number => destination.depth;

/** How many consumers are bound to it. Always answered. */
export const consumerCount = (destination: Destination): number => destination.subscribers;

/**
 * The subjects the stream captures, as a list.
 *
 * A mirror has none: it takes its messages from another stream rather than
 * from the subject space, so an empty list here is a fact about the stream and
 * not a missing field.
 */
export function subjects(destination: Destination): string[] {
  const raw = attr(destination, AttrSubjects);
  if (raw == null) return [];
  return raw
    .split(",")
    .map((subject) => subject.trim())
    .filter((subject) => subject !== "");
}

export const description = (destination: Destination): string | null =>
  attr(destination, AttrDescription);

/**
 * What the stream does when it fills up or is read.
 *
 * "limits" keeps messages until a limit is hit; "interest" keeps one only
 * while some consumer has yet to take it; "workqueue" removes each message as
 * soon as one consumer acknowledges it. The last is the one worth showing
 * prominently: it is the only setting under which reading the stream changes
 * what it holds.
 */
export const retention = (destination: Destination): string | null =>
  attr(destination, AttrRetention);

export const storage = (destination: Destination): string | null => attr(destination, AttrStorage);
export const discard = (destination: Destination): string | null => attr(destination, AttrDiscard);
export const compression = (destination: Destination): string | null =>
  attr(destination, AttrCompression);

/** How many copies the cluster keeps. One means no replication at all. */
export const replicas = (destination: Destination): number | null =>
  number(destination, AttrReplicas);

/**
 * The limits, where -1 is the server's own spelling of "no limit".
 *
 * Returned as null rather than -1 so a board can render "unlimited" without
 * every caller knowing that convention.
 */
function limit(destination: Destination, key: string): number | null {
  const value = number(destination, key);
  return value == null || value < 0 ? null : value;
}

export const maxMessages = (destination: Destination): number | null =>
  limit(destination, AttrMaxMsgs);
export const maxBytes = (destination: Destination): number | null => limit(destination, AttrMaxBytes);
export const maxMessageSize = (destination: Destination): number | null =>
  limit(destination, AttrMaxMsgSize);
export const maxMessagesPerSubject = (destination: Destination): number | null =>
  limit(destination, AttrMaxMsgsPer);

/**
 * How long a message may live, and how long a duplicate is remembered.
 *
 * Strings rather than numbers because the server reports Go durations - "24h0m0s"
 * - and reformatting them into a number of seconds would lose the unit the
 * operator wrote.
 */
export const maxAge = (destination: Destination): string | null => duration(destination, AttrMaxAge);
export const duplicateWindow = (destination: Destination): string | null =>
  duration(destination, AttrDuplicates);

function duration(destination: Destination, key: string): string | null {
  const raw = attr(destination, key);
  // Zero is how the server spells "no limit" for both of these fields, so it
  // is not a duration to render.
  return raw == null || raw === "0s" ? null : raw;
}

export const firstSequence = (destination: Destination): number | null =>
  number(destination, AttrFirstSeq);
export const lastSequence = (destination: Destination): number | null =>
  number(destination, AttrLastSeq);
export const bytes = (destination: Destination): number | null => number(destination, AttrBytes);
export const subjectCount = (destination: Destination): number | null =>
  number(destination, AttrNumSubjects);
export const deletedCount = (destination: Destination): number | null =>
  number(destination, AttrNumDeleted);

export const firstTime = (destination: Destination): string | null =>
  attr(destination, AttrFirstTime);
export const lastTime = (destination: Destination): string | null => attr(destination, AttrLastTime);
export const created = (destination: Destination): string | null => attr(destination, AttrCreated);

/** Flags an operator has to know before acting on the stream. */
export const sealed = (destination: Destination): boolean =>
  attr(destination, AttrSealed) === "true";
export const denyDelete = (destination: Destination): boolean =>
  attr(destination, AttrDenyDelete) === "true";
export const denyPurge = (destination: Destination): boolean =>
  attr(destination, AttrDenyPurge) === "true";
export const allowRollup = (destination: Destination): boolean =>
  attr(destination, AttrAllowRollup) === "true";

/**
 * Where the stream lives.
 *
 * Null on a single server, and that is a fact rather than a gap: a server
 * outside a cluster reports no cluster at all, and showing "1 of 1 replicas"
 * would dress up an unreplicated stream as a healthy one.
 */
export const clusterName = (destination: Destination): string | null =>
  attr(destination, AttrClusterName);
export const leader = (destination: Destination): string | null => attr(destination, AttrLeader);

/** One line per peer: who leads, who is current, who has fallen behind. */
export function replicaLines(destination: Destination): string[] {
  const raw = attr(destination, AttrReplicaState);
  if (raw == null) return [];
  return raw.split("\n").filter((line) => line !== "");
}

/**
 * Whether every copy of the stream is keeping up.
 *
 * Null where the stream is not replicated, false where at least one peer is
 * behind or offline. The difference matters on the board: an unreplicated
 * stream is not unhealthy, it is unprotected, and those call for different
 * things from whoever is reading.
 */
export function replicasHealthy(destination: Destination): boolean | null {
  const healthy = number(destination, AttrReplicasHealthy);
  const total = replicas(destination);
  if (healthy == null || total == null || total <= 1) return null;
  return healthy >= total;
}

/**
 * Whether this stream is a copy of another.
 *
 * A mirror cannot be published to - messages reach it only through the stream
 * it mirrors - so it is the one case where an empty subject list and a stream
 * that quietly takes no publishes are correct rather than misconfigured.
 */
export const mirrorOf = (destination: Destination): string | null => attr(destination, AttrMirrorOf);
export const sourceOf = (destination: Destination): string | null => attr(destination, AttrSourceOf);
