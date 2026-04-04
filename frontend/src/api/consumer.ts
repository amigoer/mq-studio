import * as ConsumerService from '../../bindings/rocket-leaf/internal/service/consumerservice.js'
import type { ConsumerGroupItem } from '../../bindings/rocket-leaf/internal/model/models.js'

export async function getConsumerGroups(): Promise<(ConsumerGroupItem | null)[]> {
  try {
    return await ConsumerService.GetConsumerGroups()
  } catch (e) {
    console.error('GetConsumerGroups', e)
    throw e
  }
}

export async function getConsumerGroupDetail(groupName: string): Promise<ConsumerGroupItem | null> {
  try {
    return await ConsumerService.GetConsumerGroupDetail(groupName)
  } catch (e) {
    console.error('GetConsumerGroupDetail', e)
    throw e
  }
}

export async function getConsumeStats(groupName: string): Promise<Record<string, unknown>> {
  try {
    return (await ConsumerService.GetConsumeStats(groupName)) as Record<string, unknown>
  } catch (e) {
    console.error('GetConsumeStats', e)
    throw e
  }
}

export async function createConsumerGroup(
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number
): Promise<void> {
  try {
    await ConsumerService.CreateConsumerGroup(group, brokerAddr, consumeMode, maxRetry)
  } catch (e) {
    console.error('CreateConsumerGroup', e)
    throw e
  }
}

export async function updateConsumerGroup(
  group: string,
  brokerAddr: string,
  consumeMode: string,
  maxRetry: number
): Promise<void> {
  try {
    await ConsumerService.UpdateConsumerGroup(group, brokerAddr, consumeMode, maxRetry)
  } catch (e) {
    console.error('UpdateConsumerGroup', e)
    throw e
  }
}

export async function deleteConsumerGroup(group: string, brokerAddr: string): Promise<void> {
  try {
    await ConsumerService.DeleteConsumerGroup(group, brokerAddr)
  } catch (e) {
    console.error('DeleteConsumerGroup', e)
    throw e
  }
}

export async function resetOffset(
  group: string,
  topic: string,
  timestamp: number,
  force: boolean
): Promise<void> {
  try {
    await ConsumerService.ResetOffset(group, topic, timestamp, force)
  } catch (e) {
    console.error('ResetOffset', e)
    throw e
  }
}
