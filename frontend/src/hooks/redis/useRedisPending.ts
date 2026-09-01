import { useCallback, useMemo } from "react";
import type { GroupConsumer, PendingEntry, PendingSummary } from "@/api/models";
import * as redisApi from "@/api/redis";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface PendingView {
  summary: PendingSummary | null;
  entries: PendingEntry[];
  consumers: GroupConsumer[];
}

/**
 * One group's pending list, its entries and its consumers.
 *
 * Three reads in one, because the page is not readable without all three: the
 * summary says how much is owed and by whom, the consumers say how long each
 * has been quiet, and neither means much without the entries underneath. A
 * board that loaded them separately would show three loading states for one
 * question.
 *
 * The idle filter is part of the query rather than applied afterwards. Redis
 * does the filtering, and a page that read everything and then hid most of it
 * would be paying for the whole pending list to show a corner of it.
 */
export function useRedisPending(
  stream: string | null,
  group: string | null,
  minIdleMs: number,
): BrokerData<PendingView> {
  const load = useCallback(
    async (connID: number): Promise<PendingView> => {
      if (stream == null || group == null) {
        return { summary: null, entries: [], consumers: [] };
      }
      const [summary, entries, consumers] = await Promise.all([
        redisApi.pendingSummary(connID, stream, group),
        redisApi.pendingEntries(connID, { stream, group, minIdleMs }),
        redisApi.groupConsumers(connID, stream, group),
      ]);
      return { summary, entries, consumers };
    },
    [group, minIdleMs, stream],
  );

  const options = useMemo(() => ({ enabled: stream != null && group != null }), [group, stream]);
  return useBrokerData(load, options);
}
