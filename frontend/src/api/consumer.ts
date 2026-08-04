import { ConsumerService } from '@bindings/bridge'
import type { ConsumerGroupItem } from './models'
import { present, required } from './client'

export const getConsumerGroups = (): Promise<ConsumerGroupItem[]> =>
  ConsumerService.List().then(present)
export const getConsumerGroupDetail = (group: string): Promise<ConsumerGroupItem> =>
  ConsumerService.Detail(group).then(required)
export const getConsumeStats = (group: string): Promise<Record<string, unknown>> =>
  ConsumerService.Stats(group)
export const createConsumerGroup = (
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> => ConsumerService.Create({ group, brokerAddr, consumeMode, maxRetry })
export const updateConsumerGroup = (
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> => ConsumerService.Update({ group, brokerAddr, consumeMode, maxRetry })
export const deleteConsumerGroup = (group: string, brokerAddr: string): Promise<void> =>
  ConsumerService.Remove(group, brokerAddr)
export const resetOffset = (
  group: string,
  topic: string,
  timestamp: number,
  force: boolean,
): Promise<void> => ConsumerService.ResetOffset({ group, topic, timestamp, force })
