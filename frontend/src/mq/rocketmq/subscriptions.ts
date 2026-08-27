/**
 * RocketMQ's view of a canonical subscription.
 *
 * The keys are a contract with internal/driver/rocketmq/subscription.go.
 */
import type { Subscription } from "@bindings/model/models";

const AttrConsumeMode = "consumeMode";
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
export const consumeMode = (subscription: Subscription): ConsumeMode =>
  (attr(subscription, AttrConsumeMode) ||
    ConsumeMode.Clustering) as ConsumeMode;
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
