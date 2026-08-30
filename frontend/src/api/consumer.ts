import { ConsumerService } from "@bindings/bridge";
import type { Subscription } from "./models";
import { present, required } from "./client";

export const getConsumerGroups = (connID: number): Promise<Subscription[]> =>
  ConsumerService.List(connID).then(present);
export const getConsumerGroupDetail = (connID: number, group: string): Promise<Subscription> =>
  ConsumerService.Detail(connID, group).then(required);
export const getConsumeStats = (
  connID: number,
  group: string,
): Promise<Record<string, unknown>> =>
  ConsumerService.Stats(connID, group);
export const createConsumerGroup = (
  connID: number,
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> =>
  ConsumerService.Create(connID, {
    group,
    brokerAddr,
    consumeMode,
    maxRetry,
  });
export const updateConsumerGroup = (
  connID: number,
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> =>
  ConsumerService.Update(connID, {
    group,
    brokerAddr,
    consumeMode,
    maxRetry,
  });
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
