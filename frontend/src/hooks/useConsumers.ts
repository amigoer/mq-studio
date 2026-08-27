import { useCallback, useEffect, useRef, useState } from "react";
import type { Subscription } from "@/api/models";
import * as consumerApi from "@/api/consumer";
import { useConnections } from "@/hooks/useConnections";
import { formatErrorMessage } from "@/lib/utils";

const AUTO_REFRESH_MS = 30_000;

export function useConsumers() {
  const { active, activeKey } = useConnections();
  const hasOnline = active != null;

  const [groups, setGroups] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (cancelledRef.current) return;
    const generation = requestGenerationRef.current;
    const silent = opts?.silent === true;
    if (!silent) setRefreshing(true);
    setError(null);
    try {
      const raw = await consumerApi.getConsumerGroups();
      if (cancelledRef.current || generation !== requestGenerationRef.current)
        return;
      setGroups(raw.filter(Boolean) as Subscription[]);
    } catch (e) {
      if (
        !cancelledRef.current &&
        generation === requestGenerationRef.current
      ) {
        setError(formatErrorMessage(e));
        setGroups([]);
      }
    } finally {
      if (
        !cancelledRef.current &&
        generation === requestGenerationRef.current
      ) {
        setLoading(false);
        if (!silent) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    requestGenerationRef.current += 1;
    if (!hasOnline) {
      setGroups([]);
      setLoading(false);
      return () => {
        cancelledRef.current = true;
        requestGenerationRef.current += 1;
      };
    }
    setGroups([]);
    setLoading(true);
    setRefreshing(false);
    void refresh();
    const id = window.setInterval(
      () => void refresh({ silent: true }),
      AUTO_REFRESH_MS,
    );
    return () => {
      cancelledRef.current = true;
      requestGenerationRef.current += 1;
      window.clearInterval(id);
    };
  }, [hasOnline, activeKey, refresh]);

  return { groups, loading, refreshing, error, refresh, hasOnline };
}
