import * as TopicService from '../../bindings/rocket-leaf/internal/service/topicservice.js'
import type { TopicItem } from '../../bindings/rocket-leaf/internal/model/models.js'

export async function getTopics(): Promise<(TopicItem | null)[]> {
  try {
    return await TopicService.GetTopics()
  } catch (e) {
    console.error('GetTopics', e)
    throw e
  }
}

export async function getTopicDetail(topicName: string): Promise<TopicItem | null> {
  try {
    return await TopicService.GetTopicDetail(topicName)
  } catch (e) {
    console.error('GetTopicDetail', e)
    throw e
  }
}

export async function createTopic(
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string
): Promise<void> {
  try {
    await TopicService.CreateTopic(topic, brokerAddr, readQueue, writeQueue, perm)
  } catch (e) {
    console.error('CreateTopic', e)
    throw e
  }
}

export async function getTopicStats(topicName: string): Promise<Record<string, unknown>> {
  try {
    return (await TopicService.GetTopicStats(topicName)) as Record<string, unknown>
  } catch (e) {
    console.error('GetTopicStats', e)
    throw e
  }
}

export async function updateTopic(
  topic: string,
  brokerAddr: string,
  readQueue: number,
  writeQueue: number,
  perm: string
): Promise<void> {
  try {
    await TopicService.UpdateTopic(topic, brokerAddr, readQueue, writeQueue, perm)
  } catch (e) {
    console.error('UpdateTopic', e)
    throw e
  }
}

export async function deleteTopic(topic: string, clusterName: string): Promise<void> {
  try {
    await TopicService.DeleteTopic(topic, clusterName)
  } catch (e) {
    console.error('DeleteTopic', e)
    throw e
  }
}
