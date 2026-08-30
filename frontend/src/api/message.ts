import { MessageService } from "@bindings/bridge";
import type {
  MessageItem,
  MessageTrackItem,
  ProducerClient,
  ReplayResult,
  TailBatch,
  TailCursor,
} from "./models";
import { present, required } from "./client";

export type { ProducerClient, ReplayResult, TailBatch, TailCursor };

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

/**
 * A non-positive `maxResults` lets the configured page size decide, which is
 * how the 单页拉取数量 setting reaches a query nobody narrowed by hand.
 */
export function queryMessagesByCondition(
  connID: number,
  topic: string,
  condition: QueryCondition,
  maxResults = 0,
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
  maxResults = 0,
): Promise<MessageItem[]> =>
  MessageService.DLQ(connID, group, maxResults).then(present);
export const queryRetryMessages = (
  connID: number,
  group: string,
  maxResults = 0,
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

/**
 * Runs one named client's handler on one message and returns its verdict.
 *
 * The message is consumed for real: on a client with auto-commit the offset
 * moves. It is a diagnostic with a side effect, not a dry run.
 */
export const replayMessage = (
  connID: number,
  consumerGroup: string,
  clientId: string,
  topic: string,
  messageId: string,
): Promise<ReplayResult> =>
  MessageService.Replay(connID, { consumerGroup, clientId, topic, messageId }).then(required);

/**
 * Returns what a topic has received since the cursor, and the cursor to pass
 * next time. An empty cursor opens at the topic's current end.
 */
export const tailMessages = (
  connID: number,
  topic: string,
  cursor: TailCursor,
  limit = 0,
): Promise<TailBatch> => MessageService.Tail(connID, topic, cursor, limit).then(required);
