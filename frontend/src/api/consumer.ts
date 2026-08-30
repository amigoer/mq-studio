import { ConsumerService } from "@bindings/bridge";
import type { Subscription } from "./models";
import { present } from "./client";

export const getConsumerGroups = (connID: number): Promise<Subscription[]> =>
  ConsumerService.List(connID).then(present);
export const getConsumeStats = (
  connID: number,
  group: string,
): Promise<Record<string, unknown>> =>
  ConsumerService.Stats(connID, group);
/*
 * Creating and editing a group have no wrapper here on purpose. The bridge and
 * the driver both implement them, but rocketmq-admin-go sends the config in
 * extFields where RocketMQ 5.x reads it from the body, so the broker answers
 * every create and update with a NullPointerException.
 * TestLiveConsumerGroupDelete pins that; it turns red when the library is
 * fixed, and the form goes back in then.
 */
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
