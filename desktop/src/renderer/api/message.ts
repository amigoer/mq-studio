import type { MessageItem, MessageTrackItem } from '@generated/models'
import { callBackend } from './client'

export interface QueryCondition {
  messageId?: string
  messageKey?: string
  messageTag?: string
  startTimeMs?: number
  endTimeMs?: number
}

export const fetchLatestMessages = (topic: string, maxResults: number): Promise<MessageItem[]> =>
  callBackend('messages.query', { topic, key: '', tag: '', maxResults, startTime: 0, endTime: 0 })
export function queryMessagesByCondition(
  topic: string,
  condition: QueryCondition,
  maxResults = 32,
): Promise<MessageItem[]> {
  if (condition.messageId?.trim())
    return callBackend<MessageItem>('messages.byId', {
      topic,
      messageId: condition.messageId.trim(),
    }).then((item) => (item ? [item] : []))
  return callBackend('messages.query', {
    topic,
    key: condition.messageKey?.trim() ?? '',
    tag: condition.messageTag?.trim() ?? '',
    maxResults,
    startTime: condition.startTimeMs ?? 0,
    endTime: condition.endTimeMs ?? 0,
  })
}
export const getMessageTrack = (topic: string, messageId: string): Promise<MessageTrackItem[]> =>
  callBackend('messages.track', { topic, messageId })
export const queryDLQMessages = (group: string, maxResults = 32): Promise<MessageItem[]> =>
  callBackend('messages.dlq', { group, maxResults })
export const queryRetryMessages = (group: string, maxResults = 32): Promise<MessageItem[]> =>
  callBackend('messages.retry', { group, maxResults })
export async function resendMessage(
  consumerGroup: string,
  clientId: string,
  topic: string,
  messageId: string,
): Promise<string> {
  return (
    await callBackend<{ messageId: string }>('messages.resend', {
      consumerGroup,
      clientId,
      topic,
      messageId,
    })
  ).messageId
}
export async function sendMessage(
  topic: string,
  tags: string,
  keys: string,
  body: string,
  delayLevel = 0,
): Promise<string> {
  return (
    await callBackend<{ messageId: string }>('messages.send', {
      topic,
      tags,
      keys,
      body,
      delayLevel,
    })
  ).messageId
}
