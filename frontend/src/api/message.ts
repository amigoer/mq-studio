import * as MessageService from '../../bindings/rocket-leaf/internal/service/messageservice.js'
import type { MessageItem, MessageTrackItem } from '../../bindings/rocket-leaf/internal/model/models.js'

/** 是否使用 Mock（无 Wails 环境或需离线预览时设为 true） */
const USE_MOCK = false

const LATEST_MOCK_SIZE = 32

function mockMessageItem(topic: string, index: number): MessageItem {
  const id = `mock-${topic}-${Date.now()}-${index}`
  return {
    topic,
    messageId: id,
    id: id,
    body: JSON.stringify({ index, ts: Date.now() }),
    keys: '',
    tags: `tag-${index % 3}`,
    storeTime: new Date().toISOString(),
    properties: {},
    status: 0,
  } as unknown as MessageItem
}

/**
 * 偷窥最新：拉取指定 Topic 最新 N 条消息（用于选 Topic 后自动静默拉取）
 */
export async function fetchLatestMessages(topic: string, limit: number): Promise<MessageItem[]> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 600))
    return Array.from({ length: Math.min(limit, LATEST_MOCK_SIZE) }, (_, i) => mockMessageItem(topic, i))
  }
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
 * 进阶搜索：按 Message ID / Key / 时间范围精准查询（仅用户点击「查询」时调用）
 */
export async function queryMessagesByCondition(
  topic: string,
  condition: QueryCondition,
  maxResults = 32
): Promise<MessageItem[]> {
  const { messageId, messageKey = '', messageTag = '', startTimeMs = 0, endTimeMs = 0 } = condition
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 500))
    if (messageId?.trim()) {
      const one = mockMessageItem(topic, 0)
      one.messageId = messageId.trim()
      return [one]
    }
    return Array.from({ length: 8 }, (_, i) => mockMessageItem(topic, i + 100))
  }
  try {
    if (messageId?.trim()) {
      const one = await MessageService.QueryMessageByID(topic, messageId.trim())
      return one ? [one] : []
    }
    const raw = await MessageService.QueryMessages(topic, messageKey.trim(), messageTag.trim(), maxResults, startTimeMs, endTimeMs)
    return raw.filter((m): m is MessageItem => m != null)
  } catch (e) {
    console.error('queryMessagesByCondition', e)
    throw e
  }
}

export async function getMessageTrack(
  topic: string,
  msgID: string
): Promise<MessageTrackItem[]> {
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
export async function queryRetryMessages(groupName: string, maxResults = 32): Promise<MessageItem[]> {
  try {
    const raw = await MessageService.QueryRetryMessages(groupName, maxResults)
    return raw.filter((m): m is MessageItem => m != null)
  } catch (e) {
    console.error('QueryRetryMessages', e)
    throw e
  }
}

/**
 * 重投消息到指定消费者组（直接投递）
 */
export async function resendMessage(
  consumerGroup: string,
  clientID: string,
  topic: string,
  msgID: string
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
  delayLevel = 0
): Promise<string> {
  try {
    return await MessageService.SendMessage(topic, tags, keys, body, delayLevel)
  } catch (e) {
    console.error('SendMessage', e)
    throw e
  }
}
