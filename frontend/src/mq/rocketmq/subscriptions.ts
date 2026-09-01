/**
 * RocketMQ's view of a canonical subscription.
 *
 * The keys are a contract with internal/driver/rocketmq/subscription.go.
 */
import type { Subscription } from "@bindings/model/models";

const AttrConsumeMode = "consumeMode";
const AttrBroadcast = "broadcastEnabled";
const AttrMaxRetry = "maxRetry";
const AttrRetryQps = "retryQps";
const AttrDLQ = "dlq";
const AttrRemark = "remark";
const AttrCluster = "cluster";
const AttrSubscriptions = "subscriptions";
const AttrClients = "clients";

export const ConsumeMode = {
  Clustering: "CLUSTERING",
  Broadcasting: "BROADCASTING",
} as const;
export type ConsumeMode = (typeof ConsumeMode)[keyof typeof ConsumeMode];

/** One topic a group reads, with its filter expression. */
export interface GroupSubscription {
  topic: string;
  expression: string;
  consumeTps: number;
}

/** One connected consumer process. */
export interface GroupClient {
  clientId: string;
  ip: string;
  version: string;
  lastHeartbeat: string;
}

function attr(subscription: Subscription, key: string): string {
  return subscription.attributes?.[key] ?? "";
}

function numeric(subscription: Subscription, key: string): number {
  const value = Number.parseInt(attr(subscription, key), 10);
  return Number.isNaN(value) ? 0 : value;
}

function decode<T>(subscription: Subscription, key: string): T[] {
  const encoded = attr(subscription, key);
  if (!encoded) return [];
  try {
    return JSON.parse(encoded) as T[];
  } catch {
    return [];
  }
}

export const groupName = (subscription: Subscription): string =>
  subscription.ref.name;
export const cluster = (subscription: Subscription): string =>
  attr(subscription, AttrCluster);
export const remark = (subscription: Subscription): string =>
  attr(subscription, AttrRemark);
/**
 * The message model, or null when nothing has reported one.
 *
 * A RocketMQ broker only learns it from a connected client - the subscription
 * config carries a broadcast permission, not the mode in use - so an idle
 * group has no mode rather than a clustering one.
 */
export const consumeMode = (subscription: Subscription): ConsumeMode | null =>
  (attr(subscription, AttrConsumeMode) as ConsumeMode) || null;
/**
 * Whether the broker permits this group to consume in broadcast mode.
 *
 * Not the same question as consumeMode: this is the stored permission and is
 * always known, that is what a client reports and is null while none is
 * connected. The edit form rewrites the whole subscription config, so it reads
 * this rather than inferring one from the other.
 */
export const broadcastEnabled = (subscription: Subscription): boolean =>
  attr(subscription, AttrBroadcast) === "true";
export const maxRetry = (subscription: Subscription): number =>
  numeric(subscription, AttrMaxRetry);
export const retryQps = (subscription: Subscription): number =>
  numeric(subscription, AttrRetryQps);
export const dlqCount = (subscription: Subscription): number =>
  numeric(subscription, AttrDLQ);
export const subscriptionsOf = (
  subscription: Subscription,
): GroupSubscription[] =>
  decode<GroupSubscription>(subscription, AttrSubscriptions);
export const clientsOf = (subscription: Subscription): GroupClient[] =>
  decode<GroupClient>(subscription, AttrClients);
