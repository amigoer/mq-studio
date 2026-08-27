import { ACTIVE_CONNECTION } from "./connectionScope";
import { MessageService } from "@bindings/bridge";
import type { MessageItem, MessageTrackItem } from "./models";
import { present } from "./client";

export interface QueryCondition {
  messageId?: string;
  messageKey?: string;
  messageTag?: string;
  startTimeMs?: number;
  endTimeMs?: number;
}

export const fetchLatestMessages = (
  topic: string,
  maxResults: number,
): Promise<MessageItem[]> =>
  MessageService.Query(ACTIVE_CONNECTION, {
    topic,
    key: "",
    tag: "",
    maxResults,
    startTime: 0,
    endTime: 0,
  }).then(present);

export function queryMessagesByCondition(
  topic: string,
  condition: QueryCondition,
  maxResults = 32,
): Promise<MessageItem[]> {
  if (condition.messageId?.trim())
    return MessageService.ByID(
      ACTIVE_CONNECTION,
      topic,
      condition.messageId.trim(),
    ).then((item) => (item ? [item] : []));
  return MessageService.Query(ACTIVE_CONNECTION, {
    topic,
    key: condition.messageKey?.trim() ?? "",
    tag: condition.messageTag?.trim() ?? "",
    maxResults,
    startTime: condition.startTimeMs ?? 0,
    endTime: condition.endTimeMs ?? 0,
  }).then(present);
}

export const getMessageTrack = (
  topic: string,
  messageId: string,
): Promise<MessageTrackItem[]> =>
  MessageService.Track(ACTIVE_CONNECTION, topic, messageId).then(present);
export const queryDLQMessages = (
  group: string,
  maxResults = 32,
): Promise<MessageItem[]> =>
  MessageService.DLQ(ACTIVE_CONNECTION, group, maxResults).then(present);
export const queryRetryMessages = (
  group: string,
  maxResults = 32,
): Promise<MessageItem[]> =>
  MessageService.Retry(ACTIVE_CONNECTION, group, maxResults).then(present);

export const resendMessage = (
  consumerGroup: string,
  clientId: string,
  topic: string,
  messageId: string,
): Promise<string> =>
  MessageService.Resend(ACTIVE_CONNECTION, {
    consumerGroup,
    clientId,
    topic,
    messageId,
  });

export const sendMessage = (
  topic: string,
  tags: string,
  keys: string,
  body: string,
  delayLevel = 0,
): Promise<string> =>
  MessageService.Send(ACTIVE_CONNECTION, {
    topic,
    tags,
    keys,
    body,
    delayLevel,
  });
