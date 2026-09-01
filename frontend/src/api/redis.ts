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
import { RedisStreamService } from "@bindings/bridge";
import type { TrimResult } from "@bindings/model/models";
import { required } from "./client";
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
