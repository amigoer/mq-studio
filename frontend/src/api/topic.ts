import { TopicService } from '@bindings/bridge'
import type { TopicItem } from './models'
import { present, required } from './client'

export const getTopics = (): Promise<TopicItem[]> => TopicService.List().then(present)
export const getAllTopics = (): Promise<TopicItem[]> => TopicService.ListAll().then(present)
export const getTopicDetail = (topic: string): Promise<TopicItem> =>
  TopicService.Detail(topic).then(required)
export const getTopicStats = (topic: string): Promise<Record<string, unknown>> =>
  TopicService.Stats(topic)
export const createTopic = (
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> => TopicService.Create({ topic, brokerAddr, readQueue, writeQueue, perm })
export const updateTopic = (
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string,
): Promise<void> => TopicService.Update({ topic, brokerAddr, readQueue, writeQueue, perm })
export const deleteTopic = (topic: string, clusterName: string): Promise<void> =>
  TopicService.Remove(topic, clusterName)
