import { ACTIVE_CONNECTION } from "./connectionScope";
import { ConsumerService } from "@bindings/bridge";
import type { ConsumerGroupItem } from "./models";
import { present, required } from "./client";

export const getConsumerGroups = (): Promise<ConsumerGroupItem[]> =>
  ConsumerService.List(ACTIVE_CONNECTION).then(present);
export const getConsumerGroupDetail = (
  group: string,
): Promise<ConsumerGroupItem> =>
  ConsumerService.Detail(ACTIVE_CONNECTION, group).then(required);
export const getConsumeStats = (
  group: string,
): Promise<Record<string, unknown>> =>
  ConsumerService.Stats(ACTIVE_CONNECTION, group);
export const createConsumerGroup = (
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> =>
  ConsumerService.Create(ACTIVE_CONNECTION, {
    group,
    brokerAddr,
    consumeMode,
    maxRetry,
  });
export const updateConsumerGroup = (
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> =>
  ConsumerService.Update(ACTIVE_CONNECTION, {
    group,
    brokerAddr,
    consumeMode,
    maxRetry,
  });
export const deleteConsumerGroup = (
  group: string,
  brokerAddr: string,
): Promise<void> =>
  ConsumerService.Remove(ACTIVE_CONNECTION, group, brokerAddr);
export const resetOffset = (
  group: string,
  topic: string,
  timestamp: number,
  force: boolean,
): Promise<void> =>
  ConsumerService.ResetOffset(ACTIVE_CONNECTION, {
    group,
    topic,
    timestamp,
    force,
  });
