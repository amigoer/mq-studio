/**
 * The Redis Stream surface, in Redis's own words.
 *
 * A stream is a destination, so creating and deleting one goes through the
 * canonical TopicService rather than a Redis service of its own. What this
 * file adds is the naming: TopicService.Create collects a broker address and
 * queue counts because RocketMQ's form does, and a board that had to pass
 * three zeros to make a stream would read as though it were leaving something
 * out.
 */
import { MessageService, RedisStreamService } from "@bindings/bridge";
import type {
  AckResult,
  ClaimResult,
  GroupConsumer,
  MessageItem,
  PendingEntry,
  PendingSummary,
  StreamAddResult,
  TrimResult,
} from "@bindings/model/models";
import { FILTER_CONTAINS, FILTER_FIELD } from "@/mq/redis/messages";
import { present, required } from "./client";
import * as topicApi from "./topic";

/** Creates an empty stream. Redis needs nothing but the key. */
export const createStream = (connID: number, key: string): Promise<void> =>
  topicApi.createTopic(connID, key, "", 0, 0, "");

/**
 * Deletes the key, and with it every group and pending entry on it.
 *
 * Redis has no softer form: there is no drop-if-empty and no drop-if-unused,
 * which is why the board asks before calling this and says what goes with it.
 */
export const deleteStream = (connID: number, key: string): Promise<void> =>
  topicApi.deleteTopic(connID, key, "");


/** How a trim names the bound it keeps. */
export type TrimStrategy = "maxlen" | "minid";

export interface TrimRequest {
  stream: string;
  strategy: TrimStrategy;
  /** How many of the newest entries to keep. Zero empties the stream. */
  maxLen: number;
  /** The lowest entry id to keep. */
  minId: string;
  /** Let the server stop at a node boundary: keeps at least maxLen, never fewer. */
  approx: boolean;
}

/**
 * Discards entries from the head of a stream, and reports how many went.
 *
 * The count matters even on an approximate trim, and especially then: it is
 * the only way to tell "kept a few extra at a node boundary" from "matched
 * nothing and did nothing at all".
 */
export const trimStream = (connID: number, request: TrimRequest): Promise<TrimResult> =>
  RedisStreamService.Trim(connID, request).then(required);

/**
 * Removes named entries, and reports how many were there to remove.
 *
 * Not the same as how many were asked for: deleting an id twice succeeds and
 * removes nothing.
 */
export const deleteEntries = (
  connID: number,
  stream: string,
  ids: string[],
): Promise<TrimResult> => RedisStreamService.DeleteEntries(connID, stream, ids).then(required);

/** Where a new consumer group begins reading. */
export type GroupStart = "0" | "$";

/**
 * Declares a consumer group on a stream.
 *
 * Not the canonical consumer API: that one addresses a group by name and a
 * broker address, and a Redis group's name is unique only within its stream.
 */
export const createGroup = (
  connID: number,
  stream: string,
  group: string,
  startId: GroupStart,
): Promise<void> => RedisStreamService.CreateGroup(connID, { stream, group, startId });

/**
 * Destroys a consumer group and every pending entry it holds.
 *
 * The entries stay in the stream. They are simply no longer owed to anyone,
 * which is not the same as being delivered.
 */
export const deleteGroup = (connID: number, stream: string, group: string): Promise<void> =>
  RedisStreamService.DeleteGroup(connID, stream, group);

/**
 * Moves a consumer group to a named place in the log.
 *
 * The position is an entry id, "0" for the beginning of what the stream still
 * holds, or "$" for whatever arrives next.
 *
 * It does not clear the group's pending list. Entries already handed out stay
 * owed to the consumers holding them wherever the group now reads from, and
 * nothing is redelivered on its own - consumers see entries after the new
 * position when they next ask.
 */
export const setGroupPosition = (
  connID: number,
  stream: string,
  group: string,
  position: string,
): Promise<void> => RedisStreamService.SetGroupPosition(connID, stream, group, position);

/** How a browse narrows a stream. */
export interface EntryQuery {
  stream: string;
  /** Zero lets the configured page size decide. */
  maxResults?: number;
  startTimeMs?: number;
  endTimeMs?: number;
  /** Only entries carrying a field of this name. */
  field?: string;
  /** Only entries where some field name or value contains this text. */
  contains?: string;
}

/**
 * Reads a window of a stream, newest first.
 *
 * The time range is native here rather than an approximation: a stream entry's
 * id is milliseconds plus a sequence, so a start and end timestamp are
 * literally a start and end id and the server answers the exact question.
 */
export const queryEntries = (connID: number, query: EntryQuery): Promise<MessageItem[]> =>
  MessageService.Query(connID, {
    topic: query.stream,
    key: "",
    tag: "",
    maxResults: query.maxResults ?? 0,
    startTime: query.startTimeMs ?? 0,
    endTime: query.endTimeMs ?? 0,
    filters: {
      ...(query.field ? { [FILTER_FIELD]: query.field } : {}),
      ...(query.contains ? { [FILTER_CONTAINS]: query.contains } : {}),
    },
  }).then(present);

/** Reads one entry by its id, which in this family is an exact lookup. */
export const entryById = (
  connID: number,
  stream: string,
  id: string,
): Promise<MessageItem | null> => MessageService.ByID(connID, stream, id);

/** One field of an entry being written. */
export interface EntryField {
  name: string;
  value: string;
}

export interface EntryDraft {
  stream: string;
  fields: EntryField[];
  /** An explicit entry id. Empty lets the server assign one. */
  id?: string;
  /** Writes the same entry more than once. Each copy gets its own id. */
  count?: number;
}

/**
 * Writes entries to a stream and returns the ids the server assigned.
 *
 * The ids rather than a count: an id is the only handle on an entry, so a
 * console that reported "sent 5" would leave the user unable to find any of
 * them again.
 */
export const addEntry = (connID: number, draft: EntryDraft): Promise<StreamAddResult> =>
  RedisStreamService.AddEntry(connID, {
    stream: draft.stream,
    fields: draft.fields,
    id: draft.id ?? "",
    count: draft.count ?? 1,
  }).then(required);

/** A group's pending list at a glance. */
export const pendingSummary = (
  connID: number,
  stream: string,
  group: string,
): Promise<PendingSummary> =>
  RedisStreamService.PendingSummary(connID, stream, group).then(required);

export interface PendingQuery {
  stream: string;
  group: string;
  /** One consumer's share. Empty is all of them. */
  consumer?: string;
  /** Only entries nothing has touched for at least this long. */
  minIdleMs?: number;
  count?: number;
}

/** Walks a group's pending list. */
export const pendingEntries = (
  connID: number,
  query: PendingQuery,
): Promise<PendingEntry[]> =>
  RedisStreamService.PendingEntries(connID, {
    stream: query.stream,
    group: query.group,
    consumer: query.consumer ?? "",
    minIdleMs: query.minIdleMs ?? 0,
    count: query.count ?? 0,
  }).then(present);

/** A group's members, and how long each has been quiet. */
export const groupConsumers = (
  connID: number,
  stream: string,
  group: string,
): Promise<GroupConsumer[]> =>
  RedisStreamService.GroupConsumers(connID, stream, group).then(present);

/**
 * Settles entries so they stop being owed.
 *
 * Quietly destructive: the entry stays in the stream and the group never reads
 * it again, and nothing about the outcome distinguishes that from a job well
 * done. The count returned is how many were actually owed - not how many were
 * named - so a zero means somebody else settled them first.
 */
export const ackEntries = (
  connID: number,
  stream: string,
  group: string,
  ids: string[],
): Promise<AckResult> =>
  RedisStreamService.AckEntries(connID, stream, group, ids).then(required);

export interface ClaimRequest {
  stream: string;
  group: string;
  /** The new owner. It need not exist yet - claiming creates it. */
  consumer: string;
  ids: string[];
  /** Refuses to move anything touched more recently than this. */
  minIdleMs?: number;
}

/** Moves named entries to another consumer. */
export const claimEntries = (connID: number, request: ClaimRequest): Promise<ClaimResult> =>
  RedisStreamService.ClaimEntries(connID, {
    stream: request.stream,
    group: request.group,
    consumer: request.consumer,
    ids: request.ids,
    minIdleMs: request.minIdleMs ?? 0,
  }).then(required);

export interface AutoClaimRequest {
  stream: string;
  group: string;
  consumer: string;
  minIdleMs: number;
  count?: number;
}

/**
 * Moves whatever has been idle too long, without naming ids.
 *
 * It reports what it found gone as well as what it moved: an entry can be in a
 * pending list and no longer in the stream, and those are dropped rather than
 * reassigned - work lost rather than moved, which is the one thing about this
 * gesture worth saying out loud.
 */
export const autoClaim = (connID: number, request: AutoClaimRequest): Promise<ClaimResult> =>
  RedisStreamService.AutoClaim(connID, {
    stream: request.stream,
    group: request.group,
    consumer: request.consumer,
    minIdleMs: request.minIdleMs,
    start: "",
    count: request.count ?? 0,
  }).then(required);
