import * as TopicService from '../../bindings/rocket-leaf/internal/service/topicservice.js'
import type { TopicItem, TopicRouteItem } from '../../bindings/rocket-leaf/internal/model/models.js'

export async function getTopics(): Promise<(TopicItem | null)[]> {
  try {
    return await TopicService.GetTopics()
  } catch (e) {
    console.error('GetTopics', e)
    throw e
  }
}

export async function getTopicsByCluster(clusterName: string): Promise<(TopicItem | null)[]> {
  try {
    return await TopicService.GetTopicsByCluster(clusterName)
  } catch (e) {
    console.error('GetTopicsByCluster', e)
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

export async function getTopicRoute(topicName: string): Promise<TopicRouteItem[]> {
  try {
    return await TopicService.GetTopicRoute(topicName)
  } catch (e) {
    console.error('GetTopicRoute', e)
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
