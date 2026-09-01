/**
 * Pulsar's view of the canonical dead-letter model.
 *
 * There is no broker-side dead-letter object on this family. What there is, is
 * a convention in the official client libraries: a consumer with a DLQ policy
 * republishes to "<topic>-<subscription>-DLQ", and retries go to
 * "<topic>-<subscription>-RETRY". Both are ordinary topics that happen to be
 * named that way, which is why the driver finds them by walking a namespace
 * and why a row can exist with no source at all.
 */
import type { DeadLetterQueue } from "@bindings/model/models";

/** Which half of the convention a topic follows. */
export const DeadLetterKind = { Dlq: "dlq", Retry: "retry" } as const;
export type DeadLetterKindValue = (typeof DeadLetterKind)[keyof typeof DeadLetterKind];

/**
 * A retry topic is a pipeline; a DLQ is where it ends up.
 *
 * Worth distinguishing on the page: a growing retry topic means consumers are
 * failing and recovering, and a growing DLQ means they have given up.
 */
export function kindOf(queue: DeadLetterQueue): DeadLetterKindValue {
  return queue.name.endsWith("-RETRY") ? DeadLetterKind.Retry : DeadLetterKind.Dlq;
}

/** The topic that dead-lettered here, or "" when its origin is gone. */
export function sourceTopic(queue: DeadLetterQueue): string {
  return queue.sources?.[0]?.queue ?? "";
}

/**
 * The subscription that gave up, or "".
 *
 * This is the answer the page exists for: one topic read by five
 * subscriptions has five separate dead-letter topics, and naming only the
 * topic would not say which reader is failing.
 */
export function sourceSubscription(queue: DeadLetterQueue): string {
  return queue.sources?.[0]?.subscription ?? "";
}

/**
 * Whether this topic's origin could not be resolved.
 *
 * An orphan holds a backlog nothing will ever drain and nobody will ever look
 * at, which is the single most useful row on the page - so it is drawn as a
 * finding rather than as a row with blank columns.
 */
export const isOrphaned = (queue: DeadLetterQueue): boolean =>
  (queue.sources?.length ?? 0) === 0;

/** A figure the driver did not report, as null rather than zero. */
export function reported(value: number): number | null {
  return value === -1 ? null : value;
}
