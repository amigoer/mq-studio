import { MessageService } from '@bindings/bridge'
import type { MessageItem, MessageTrackItem } from './models'
import { present } from './client'

export interface QueryCondition {
  messageId?: string
  messageKey?: string
  messageTag?: string
  startTimeMs?: number
  endTimeMs?: number
}

export const fetchLatestMessages = (topic: string, maxResults: number): Promise<MessageItem[]> =>
  MessageService.Query({ topic, key: '', tag: '', maxResults, startTime: 0, endTime: 0 }).then(
    present,
  )

export function queryMessagesByCondition(
  topic: string,
  condition: QueryCondition,
  maxResults = 32,
): Promise<MessageItem[]> {
  if (condition.messageId?.trim())
    return MessageService.ByID(topic, condition.messageId.trim()).then((item) =>
      item ? [item] : [],
    )
  return MessageService.Query({
    topic,
    key: condition.messageKey?.trim() ?? '',
    tag: condition.messageTag?.trim() ?? '',
    maxResults,
    startTime: condition.startTimeMs ?? 0,
    endTime: condition.endTimeMs ?? 0,
  }).then(present)
}

export const getMessageTrack = (topic: string, messageId: string): Promise<MessageTrackItem[]> =>
  MessageService.Track(topic, messageId).then(present)
export const queryDLQMessages = (group: string, maxResults = 32): Promise<MessageItem[]> =>
  MessageService.DLQ(group, maxResults).then(present)
export const queryRetryMessages = (group: string, maxResults = 32): Promise<MessageItem[]> =>
  MessageService.Retry(group, maxResults).then(present)

export const resendMessage = (
  consumerGroup: string,
  clientId: string,
  topic: string,
  messageId: string,
): Promise<string> => MessageService.Resend({ consumerGroup, clientId, topic, messageId })

export const sendMessage = (
  topic: string,
  tags: string,
  keys: string,
  body: string,
  delayLevel = 0,
): Promise<string> => MessageService.Send({ topic, tags, keys, body, delayLevel })
