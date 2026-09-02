import { useCallback, useState } from "react";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import * as redisApi from "@/api/redis";
import type { EntryQuery } from "@/api/redis";
import type { MessageItem } from "@/api/models";

export interface RedisEntries {
  items: MessageItem[];
  /** True while a read is in flight. */
  running: boolean;
  /** How many the last read returned, or null before the first one. */
  lastCount: number | null;
  query: (request: EntryQuery) => Promise<void>;
  /** Shaped for BoardState, which every board's empty and error states use. */
  state: {
    loading: boolean;
    error: string | null;
    online: boolean;
    refresh: () => Promise<void>;
  };
}

/**
 * Browsing a stream, which is a gesture rather than a poll.
 *
 * Deliberately not useBrokerData. A stream can hold millions of entries and a
 * read is bounded by whatever window the user asked for, so a page that
 * re-read itself every thirty seconds would keep moving under someone who was
 * reading a row - and on a filtered query it would scan ten times the page
 * size each time for nothing.
 */
export function useRedisEntries(): RedisEntries {
  const { id: connID, online } = useConnectionScope();
  const [items, setItems] = useState<MessageItem[]>([]);
  const [running, setRunning] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<EntryQuery | null>(null);

  const query = useCallback(
    async (request: EntryQuery) => {
      if (!online) return;
      setRunning(true);
      setError(null);
      setLast(request);
      try {
        const read = await redisApi.queryEntries(connID, request);
        setItems(read);
        setLastCount(read.length);
      } catch (queryError) {
        setItems([]);
        setLastCount(null);
        setError(formatErrorMessage(queryError));
      } finally {
        setRunning(false);
      }
    },
    [connID, online],
  );

  const refresh = useCallback(async () => {
    if (last != null) await query(last);
  }, [last, query]);

  return {
    items,
    running,
    lastCount,
    query,
    state: { loading: running && lastCount === null, error, online, refresh },
  };
}
