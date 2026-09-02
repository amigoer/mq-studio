import { useCallback } from "react";
import type { Destination } from "@/api/models";
import * as topicApi from "@/api/topic";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every JetStream stream in the connected account.
 *
 * It goes through the canonical destination API rather than a NATS one: a
 * stream is a destination, one request answers the whole list, and what only
 * NATS has - the subjects it captures, its retention policy, where its
 * replicas live - rides in the attribute map.
 *
 * The list excludes the streams JetStream makes for its own features. KV
 * buckets and object stores are streams underneath, and putting a dozen rows
 * nobody declared above the ones somebody did would make the page unreadable
 * on any cluster that uses them.
 */
export function useNatsStreams(): BrokerData<Destination[]> {
  const load = useCallback((connID: number) => topicApi.getTopics(connID), []);
  return useBrokerData(load);
}

/**
 * One stream in full.
 *
 * A second request rather than a field on the list, because the detail carries
 * the per-subject message counts - one entry for every subject the stream has
 * ever seen, which on a wildcard stream is unbounded. Asking for it per row
 * would make the list cost grow with the subject space.
 */
export function useNatsStreamDetail(name: string | null): BrokerData<Destination | null> {
  const load = useCallback(
    async (connID: number) => (name == null ? null : topicApi.getTopicDetail(connID, name)),
    [name],
  );
  return useBrokerData(load, { enabled: name != null, refreshMs: null });
}
