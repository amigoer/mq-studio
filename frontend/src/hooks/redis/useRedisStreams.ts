import { useCallback } from "react";
import type { Destination } from "@/api/models";
import * as topicApi from "@/api/topic";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every stream the connection's key pattern matches.
 *
 * It goes through the canonical destination API rather than a Redis one: a
 * stream is a destination, one request answers the whole list, and what only
 * Redis has rides in the attribute map.
 *
 * What comes back is what the scan found, not a count of what exists. SCAN is
 * a cursor rather than a snapshot and the driver caps the walk, so the board
 * says how many it found rather than presenting the number as a total.
 */
export function useRedisStreams(): BrokerData<Destination[]> {
  const load = useCallback((connID: number) => topicApi.getTopics(connID), []);
  return useBrokerData(load);
}

/** One stream's detail, including the names of the groups reading it. */
export function useRedisStreamDetail(key: string | null): BrokerData<Destination | null> {
  const load = useCallback(
    async (connID: number) => (key == null ? null : topicApi.getTopicDetail(connID, key)),
    [key],
  );
  return useBrokerData(load, { enabled: key != null, refreshMs: null });
}
