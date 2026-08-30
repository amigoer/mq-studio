import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";

/** How often a page re-reads on its own while it is open. */
export const AUTO_REFRESH_MS = 30_000;

export interface BrokerData<T> {
  /** Null until the first load for this connection lands. */
  data: T | null;
  /** True while the first load for this connection is in flight. */
  loading: boolean;
  /** True while a later load is in flight; the previous data is still shown. */
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** False when nothing is dialled, which is why the page has no data. */
  online: boolean;
}

/**
 * Reads one thing from the connection the page is scoped to.
 *
 * Four boards used to carry their own copy of this: the same generation guard,
 * the same silent-refresh interval, the same "clear on connection change". The
 * differences between them were the request and nothing else.
 *
 * `load` must be stable - wrap it in useCallback - because it is what decides
 * when the query changes. Passing an inline function re-runs it every render.
 */
export function useBrokerData<T>(
  load: (connID: number) => Promise<T>,
  options: { refreshMs?: number | null; enabled?: boolean } = {},
): BrokerData<T> {
  const { refreshMs = AUTO_REFRESH_MS, enabled = true } = options;
  const { id: connID, online } = useConnectionScope();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped whenever the query or the connection changes, so a reply that was
  // already in the air cannot overwrite what replaced it.
  const generation = useRef(0);
  const active = enabled && online && connID !== 0;

  const run = useCallback(
    async (silent: boolean) => {
      if (!active) return;
      const current = ++generation.current;
      if (silent) setRefreshing(true);
      try {
        const next = await load(connID);
        if (current !== generation.current) return;
        setData(next);
        setError(null);
      } catch (failure) {
        if (current !== generation.current) return;
        setError(formatErrorMessage(failure));
        setData(null);
      } finally {
        if (current === generation.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [active, connID, load],
  );

  const refresh = useCallback(() => run(true), [run]);

  useEffect(() => {
    generation.current += 1;
    setData(null);
    setError(null);
    setRefreshing(false);
    if (!active) {
      // Not an error: the shell renders pages before anything is dialled, and
      // an empty page that says so is the honest state.
      setLoading(false);
      return;
    }
    setLoading(true);
    void run(false);
    if (refreshMs == null) return;
    const timer = window.setInterval(() => void run(true), refreshMs);
    return () => window.clearInterval(timer);
  }, [active, refreshMs, run]);

  return { data, loading, refreshing, error, refresh, online };
}
