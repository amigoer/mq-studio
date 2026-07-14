import type { TopicItem } from '@generated/models'
import { callBackend } from './client'

export const getTopics = (): Promise<TopicItem[]> => callBackend('topics.list')
export const getAllTopics = (): Promise<TopicItem[]> => callBackend('topics.listAll')
export const getTopicDetail = (topic: string): Promise<TopicItem> =>
  callBackend('topics.detail', { topic })
export const getTopicStats = (topic: string): Promise<Record<string, unknown>> =>
  callBackend('topics.stats', { topic })
export const createTopic = (
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> => callBackend('topics.create', { topic, brokerAddr, readQueue, writeQueue, perm })
export const updateTopic = (
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> => callBackend('topics.update', { topic, brokerAddr, readQueue, writeQueue, perm })
export const deleteTopic = (topic: string, clusterName: string): Promise<void> =>
  callBackend('topics.remove', { topic, clusterName })
