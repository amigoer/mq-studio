import { MessageService } from "@bindings/bridge";
import type { MessageItem, MessageTrackItem, ProducerClient } from "./models";
import { present } from "./client";

export type { ProducerClient };

export interface QueryCondition {
  messageId?: string;
  messageKey?: string;
  messageTag?: string;
  startTimeMs?: number;
  endTimeMs?: number;
}

export const fetchLatestMessages = (
  connID: number,
  topic: string,
  maxResults: number,
): Promise<MessageItem[]> =>
  MessageService.Query(connID, {
    topic,
    key: "",
    tag: "",
    maxResults,
    startTime: 0,
    endTime: 0,
  }).then(present);

export function queryMessagesByCondition(
  connID: number,
  topic: string,
  condition: QueryCondition,
  maxResults = 32,
): Promise<MessageItem[]> {
  if (condition.messageId?.trim())
    return MessageService.ByID(
      connID,
      topic,
      condition.messageId.trim(),
    ).then((item) => (item ? [item] : []));
  return MessageService.Query(connID, {
    topic,
    key: condition.messageKey?.trim() ?? "",
    tag: condition.messageTag?.trim() ?? "",
    maxResults,
    startTime: condition.startTimeMs ?? 0,
    endTime: condition.endTimeMs ?? 0,
  }).then(present);
}

export const getMessageTrack = (
  connID: number,
  topic: string,
  messageId: string,
): Promise<MessageTrackItem[]> =>
  MessageService.Track(connID, topic, messageId).then(present);
export const queryDLQMessages = (
  connID: number,
  group: string,
  maxResults = 32,
): Promise<MessageItem[]> =>
  MessageService.DLQ(connID, group, maxResults).then(present);
export const queryRetryMessages = (
  connID: number,
  group: string,
  maxResults = 32,
): Promise<MessageItem[]> =>
  MessageService.Retry(connID, group, maxResults).then(present);

export const resendMessage = (
  connID: number,
  consumerGroup: string,
  clientId: string,
  topic: string,
  messageId: string,
): Promise<string> =>
  MessageService.Resend(connID, {
    consumerGroup,
    clientId,
    topic,
    messageId,
  });

export const sendMessage = (
  connID: number,
  topic: string,
  tags: string,
  keys: string,
  body: string,
  delayLevel = 0,
): Promise<string> =>
  MessageService.Send(connID, {
    topic,
    tags,
    keys,
    body,
    delayLevel,
  });

/**
 * Who is currently publishing under one producer group.
 *
 * The group has to be named: a broker indexes connections by producer group
 * and offers no call that enumerates the groups, so this answers "is anything
 * from this service still connected", not "who is writing here".
 */
export const getProducers = (
  connID: number,
  group: string,
  topic: string,
): Promise<ProducerClient[]> => MessageService.Producers(connID, group, topic).then(present);
