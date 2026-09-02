import { NATSService } from "@bindings/bridge";
import type {
  NATSConsumerInput,
  PurgeInput,
  StreamInput,
} from "@bindings/bridge/models";
import type { TrimResult } from "@bindings/model/models";
import { required } from "./client";

export type { NATSConsumerInput, PurgeInput, StreamInput };

/**
 * The NATS-only half of the surface.
 *
 * Reading streams is not here: a stream is a destination, and api/topic.ts
 * already answers the whole read side. What this carries is the writing, which
 * the canonical service cannot express - its create collects a broker address,
 * a read queue, a write queue and a permission mask, and a JetStream stream
 * has none of those.
 */

/** Declares a stream. Refused if one of that name already exists. */
export const createStream = (connID: number, input: StreamInput): Promise<void> =>
  NATSService.CreateStream(connID, input);

/**
 * Rewrites an existing stream's configuration.
 *
 * Separate from the create rather than one idempotent call: a create that
 * quietly became an update would rewrite another application's subjects, and
 * an update that quietly became a create would hide a stream somebody had
 * deleted underneath the page.
 */
export const updateStream = (connID: number, input: StreamInput): Promise<void> =>
  NATSService.UpdateStream(connID, input);

/** Removes a stream and every message in it. */
export const deleteStream = (connID: number, name: string): Promise<void> =>
  NATSService.DeleteStream(connID, name);

/**
 * Discards messages from the head of a stream.
 *
 * The count that comes back is the report rather than a formality: it is the
 * only way to tell a bound that already held from one that matched nothing at
 * all, and those look identical on the page.
 */
export const purgeStream = (connID: number, input: PurgeInput): Promise<TrimResult> =>
  NATSService.PurgeStream(connID, input).then(required);

/** Removes messages by sequence, and reports how many were there to remove. */
export const deleteMessages = (
  connID: number,
  stream: string,
  sequences: string[],
): Promise<TrimResult> => NATSService.DeleteMessages(connID, stream, sequences).then(required);

/** Declares a consumer on a stream. Refused if one of that name exists. */
export const createConsumer = (connID: number, input: NATSConsumerInput): Promise<void> =>
  NATSService.CreateConsumer(connID, input);

/**
 * Rewrites an existing consumer's configuration.
 *
 * Not where it reads from: the server refuses to change a consumer's delivery
 * policy after it exists, which is why there is no reset-position call here at
 * all.
 */
export const updateConsumer = (connID: number, input: NATSConsumerInput): Promise<void> =>
  NATSService.UpdateConsumer(connID, input);

/** Removes a consumer and the position it held. */
export const deleteConsumer = (connID: number, stream: string, name: string): Promise<void> =>
  NATSService.DeleteConsumer(connID, stream, name);
