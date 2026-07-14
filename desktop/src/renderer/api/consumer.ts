import type { ConsumerGroupItem } from '@generated/models'
import { callBackend } from './client'

export const getConsumerGroups = (): Promise<ConsumerGroupItem[]> => callBackend('consumers.list')
export const getConsumerGroupDetail = (group: string): Promise<ConsumerGroupItem> =>
  callBackend('consumers.detail', { group })
export const getConsumeStats = (group: string): Promise<Record<string, unknown>> =>
  callBackend('consumers.stats', { group })
export const createConsumerGroup = (
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> => callBackend('consumers.create', { group, brokerAddr, consumeMode, maxRetry })
export const updateConsumerGroup = (
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number,
): Promise<void> => callBackend('consumers.update', { group, brokerAddr, consumeMode, maxRetry })
export const deleteConsumerGroup = (group: string, brokerAddr: string): Promise<void> =>
  callBackend('consumers.remove', { group, brokerAddr })
export const resetOffset = (
  group: string,
  topic: string,
  timestamp: number,
  force: boolean,
): Promise<void> => callBackend('consumers.resetOffset', { group, topic, timestamp, force })
