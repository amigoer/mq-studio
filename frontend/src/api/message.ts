import * as MessageService from '../../bindings/rocket-leaf/internal/service/messageservice.js'
import type {
  MessageItem,
  MessageTrackItem,
} from '../../bindings/rocket-leaf/internal/model/models.js'

/**
 * 拉取指定 Topic 最新 N 条消息（用于选 Topic 后自动静默拉取）
 */
export async function fetchLatestMessages(topic: string, limit: number): Promise<MessageItem[]> {
  try {
    const raw = await MessageService.QueryMessages(topic, '', '', limit, 0, 0)
    return raw.filter((m): m is MessageItem => m != null)
  } catch (e) {
    console.error('fetchLatestMessages', e)
    throw e
  }
}

export interface QueryCondition {
  messageId?: string
  messageKey?: string
  messageTag?: string
  startTimeMs?: number
  endTimeMs?: number
}

/**
 * 按 Message ID / Key / 时间范围精准查询（仅用户点击「查询」时调用）
 */
export async function queryMessagesByCondition(
  topic: string,
  condition: QueryCondition,
  maxResults = 32,
): Promise<MessageItem[]> {
  const { messageId, messageKey = '', messageTag = '', startTimeMs = 0, endTimeMs = 0 } = condition
  try {
    if (messageId?.trim()) {
      const one = await MessageService.QueryMessageByID(topic, messageId.trim())
      return one ? [one] : []
    }
    const raw = await MessageService.QueryMessages(
      topic,
      messageKey.trim(),
      messageTag.trim(),
      maxResults,
      startTimeMs,
      endTimeMs,
    )
    return raw.filter((m): m is MessageItem => m != null)
  } catch (e) {
    console.error('queryMessagesByCondition', e)
    throw e
  }
}

export async function getMessageTrack(topic: string, msgID: string): Promise<MessageTrackItem[]> {
  try {
    const raw = await MessageService.GetMessageTrack(topic, msgID)
    return raw.filter((m): m is MessageTrackItem => m != null)
  } catch (e) {
    console.error('GetMessageTrack', e)
    throw e
  }
}

/**
 * 查询消费者组的死信队列消息
 */
export async function queryDLQMessages(groupName: string, maxResults = 32): Promise<MessageItem[]> {
  try {
    const raw = await MessageService.QueryDLQMessages(groupName, maxResults)
    return raw.filter((m): m is MessageItem => m != null)
  } catch (e) {
    console.error('QueryDLQMessages', e)
    throw e
  }
}

/**
 * 查询消费者组的重试队列消息
 */
export async function queryRetryMessages(
  groupName: string,
  maxResults = 32,
): Promise<MessageItem[]> {
  try {
    const raw = await MessageService.QueryRetryMessages(groupName, maxResults)
    return raw.filter((m): m is MessageItem => m != null)
  } catch (e) {
    console.error('QueryRetryMessages', e)
    throw e
  }
}

/**
 * 将原消息内容重新发布到原 Topic。
 */
export async function resendMessage(
  consumerGroup: string,
  clientID: string,
  topic: string,
  msgID: string,
): Promise<string> {
  try {
    return await MessageService.ResendMessage(consumerGroup, clientID, topic, msgID)
  } catch (e) {
    console.error('ResendMessage', e)
    throw e
  }
}

export async function sendMessage(
  topic: string,
  tags: string,
  keys: string,
  body: string,
  delayLevel = 0,
): Promise<string> {
  try {
    return await MessageService.SendMessage(topic, tags, keys, body, delayLevel)
  } catch (e) {
    console.error('SendMessage', e)
    throw e
  }
}
