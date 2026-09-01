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
