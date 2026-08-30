/**
 * RocketMQ's view of a canonical destination.
 *
 * Everything here reads the attribute map the Go driver fills. The keys are a
 * contract between internal/driver/rocketmq/destination.go and this file, not
 * part of the shared vocabulary, which is why they are named in one place.
 */
import type { Destination } from "@bindings/model/models";

const AttrReadQueue = "readQueue";
const AttrWriteQueue = "writeQueue";
const AttrPerm = "perm";
const AttrMessageType = "messageType";
const AttrCluster = "cluster";
const AttrDescription = "description";
const AttrConsumerGroups = "consumerGroups";
const AttrRoutes = "routes";
const AttrSubscribers = "subscribers";

/** A numeric field no broker reported. The UI renders it as an em dash. */
export const UNKNOWN_METRIC = -1;

export const TopicPerm = {
  ReadWrite: "RW",
  ReadOnly: "R",
  WriteOnly: "W",
  Deny: "DENY",
} as const;
export type TopicPerm = (typeof TopicPerm)[keyof typeof TopicPerm];

export const TopicMessageType = {
  Normal: "Normal",
  FIFO: "FIFO",
  Delay: "Delay",
} as const;
export type TopicMessageType =
  (typeof TopicMessageType)[keyof typeof TopicMessageType];

/** One broker's copy of a topic configuration. */
export interface TopicRouteItem {
  broker: string;
  brokerAddr: string;
  readQueue: number;
  writeQueue: number;
  perm: TopicPerm;
}

function attr(destination: Destination, key: string): string {
  return destination.attributes?.[key] ?? "";
}

function numeric(destination: Destination, key: string): number {
  const raw = attr(destination, key);
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? UNKNOWN_METRIC : value;
}

export const topicName = (destination: Destination): string =>
  destination.ref.name;
export const cluster = (destination: Destination): string =>
  attr(destination, AttrCluster);
export const description = (destination: Destination): string =>
  attr(destination, AttrDescription);
export const readQueue = (destination: Destination): number =>
  numeric(destination, AttrReadQueue);
export const writeQueue = (destination: Destination): number =>
  numeric(destination, AttrWriteQueue);
export const perm = (destination: Destination): TopicPerm =>
  (attr(destination, AttrPerm) || TopicPerm.ReadWrite) as TopicPerm;
export const messageType = (destination: Destination): TopicMessageType =>
  (attr(destination, AttrMessageType) ||
    TopicMessageType.Normal) as TopicMessageType;
export const consumerGroups = (destination: Destination): number =>
  numeric(destination, AttrConsumerGroups);

/**
 * How a topic reads in the list.
 *
 * RocketMQ's own message type covers ordered and delayed; retry and dead
 * letter are not a type at all but a name the broker mints per consumer
 * group, which is why they are read off the prefix.
 */
export const TopicKind = {
  Normal: "normal",
  FIFO: "fifo",
  Delay: "delay",
  Retry: "retry",
  DLQ: "dlq",
} as const;
export type TopicKind = (typeof TopicKind)[keyof typeof TopicKind];

const RETRY_PREFIXES = ["%RETRY%", "RETRY%"];
const DLQ_PREFIXES = ["%DLQ%", "DLQ%"];

export function topicKind(destination: Destination): TopicKind {
  const name = topicName(destination);
  if (RETRY_PREFIXES.some((prefix) => name.startsWith(prefix)))
    return TopicKind.Retry;
  if (DLQ_PREFIXES.some((prefix) => name.startsWith(prefix)))
    return TopicKind.DLQ;
  const type = messageType(destination);
  if (type === TopicMessageType.FIFO) return TopicKind.FIFO;
  if (type === TopicMessageType.Delay) return TopicKind.Delay;
  return TopicKind.Normal;
}

/**
 * The per-broker route table.
 *
 * It crosses as JSON because a destination's attributes are strings and a
 * route table is a list. That is the escape hatch's real limit rather than a
 * preference, and it is worth settling before a second driver leans on it.
 */
export function routes(destination: Destination): TopicRouteItem[] {
  const encoded = attr(destination, AttrRoutes);
  if (!encoded) return [];
  try {
    return JSON.parse(encoded) as TopicRouteItem[];
  } catch {
    return [];
  }
}

/** The groups subscribing to a topic. Only a topic detail lookup fills it. */
export function subscribers(destination: Destination): string[] {
  const encoded = attr(destination, AttrSubscribers);
  if (!encoded) return [];
  try {
    return JSON.parse(encoded) as string[];
  } catch {
    return [];
  }
}

/** The attributes a create or edit form submits back. */
export function destinationSpecAttributes(input: {
  brokerAddr: string;
  readQueue: number;
  writeQueue: number;
  perm: string;
}): Record<string, string> {
  return {
    brokerAddr: input.brokerAddr,
    [AttrReadQueue]: String(input.readQueue),
    [AttrWriteQueue]: String(input.writeQueue),
    [AttrPerm]: input.perm,
  };
}
