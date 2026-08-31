/**
 * What the reassignment form collects, and what it will not send.
 *
 * Beside the dialog rather than inside it because these rules are the part
 * worth testing, and a component module drags the whole shell in with it.
 */

export interface ReassignDraft {
  /** Broker ids as typed: a comma-separated, ordered list. */
  brokers: string;
}

export function emptyReassignDraft(replicas: readonly number[] = []): ReassignDraft {
  return { brokers: replicas.join(", ") };
}

/**
 * Reads the typed list into broker ids.
 *
 * Ordered, and the order is load-bearing: the first broker becomes the
 * preferred leader, so the same brokers in a different order is a different
 * plan. Returns null when a field is not a list of numbers.
 */
export function parseBrokerList(raw: string): number[] | null {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;

  const ids: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    ids.push(Number.parseInt(part, 10));
  }
  return ids;
}

export function validateReassignDraft(
  draft: ReassignDraft,
  clusterBrokers: readonly number[],
): string | null {
  const ids = parseBrokerList(draft.brokers);
  if (ids == null) return "brokersRequired";
  // Two copies on one broker is not two replicas.
  if (new Set(ids).size !== ids.length) return "duplicate";
  for (const id of ids) {
    // Kafka accepts a plan naming a broker that does not exist: the copy never
    // starts and the move sits in flight until somebody cancels it.
    if (!clusterBrokers.includes(id)) return "unknownBroker";
  }
  if (ids.length > clusterBrokers.length) return "tooMany";
  return null;
}

/** Whether the plan is the placement the partition already has. */
export function isUnchanged(draft: ReassignDraft, current: readonly number[]): boolean {
  const ids = parseBrokerList(draft.brokers);
  if (ids == null || ids.length !== current.length) return false;
  return ids.every((id, index) => id === current[index]);
}
