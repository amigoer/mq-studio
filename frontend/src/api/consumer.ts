import { ConsumerService } from "@bindings/bridge";
import type { SubscriptionClient } from "@bindings/model/models";
import type { Subscription } from "./models";
import { present } from "./client";

export const getConsumerGroups = (connID: number): Promise<Subscription[]> =>
  ConsumerService.List(connID).then(present);
export const getConsumeStats = (
  connID: number,
  group: string,
): Promise<Record<string, unknown>> =>
  ConsumerService.Stats(connID, group);

/**
 * Asks every connected consumer in a group what it holds.
 *
 * One broker round trip per client, so this is only worth paying for a group
 * somebody has opened - the group list must not call it.
 */
export const getConsumerClients = (
  connID: number,
  group: string,
): Promise<SubscriptionClient[]> =>
  ConsumerService.Clients(connID, group).then(present);

/**
 * Creates a consumer group, or rewrites an existing one.
 *
 * The broker upserts either way; the two calls exist so the form can say which
 * it meant and the caller can report it. brokerAddr empty means every master.
 *
 * consumeMode here is the broadcast *permission* the config stores, not the
 * model a client reports - the driver maps BROADCASTING onto
 * consumeBroadcastEnable. Because the whole config is rewritten, an edit must
 * send the group's current permission back or it silently clears it.
 */
export const createConsumerGroup = (
  connID: number,
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> =>
  ConsumerService.Create(connID, { group, brokerAddr, consumeMode, maxRetry });
export const updateConsumerGroup = (
  connID: number,
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> =>
  ConsumerService.Update(connID, { group, brokerAddr, consumeMode, maxRetry });

export const deleteConsumerGroup = (
  connID: number,
  group: string,
  brokerAddr: string,
): Promise<void> =>
  ConsumerService.Remove(connID, group, brokerAddr);
export const resetOffset = (
  connID: number,
  group: string,
  topic: string,
  timestamp: number,
  force: boolean,
): Promise<void> =>
  ConsumerService.ResetOffset(connID, {
    group,
    topic,
    timestamp,
    force,
  });

/**
 * Copies one group's per-queue positions onto another.
 *
 * An empty destination copies every topic the source reads. `fromOffline`
 * reads the source's stored offsets rather than its live consumers, which is
 * what a group that has already been shut down needs.
 */
export const cloneOffset = (
  connID: number,
  from: string,
  to: string,
  destination: string,
  fromOffline: boolean,
): Promise<void> =>
  ConsumerService.CloneOffset(connID, { from, to, destination, fromOffline });

/**
 * Writes one queue's committed offset for a group.
 *
 * The broker is named rather than addressed: per-queue progress rows are keyed
 * by broker name, which is the only identity a message queue carries.
 */
export const setQueueOffset = (
  connID: number,
  group: string,
  topic: string,
  broker: string,
  queueId: number,
  offset: number,
): Promise<void> =>
  ConsumerService.SetQueueOffset(connID, { group, topic, broker, queueId, offset });
