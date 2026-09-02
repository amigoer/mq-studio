import { NATSService } from "@bindings/bridge";
import type { StreamInput } from "@bindings/bridge/models";

export type { StreamInput };

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
