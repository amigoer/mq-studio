import { useCallback, useEffect, useRef, useState } from "react";
import type { ClusterView, Node } from "@/api/models";
import * as clusterApi from "@/api/cluster";
import { useConnections } from "@/hooks/useConnections";
import { formatErrorMessage } from "@/lib/utils";

const AUTO_REFRESH_MS = 30_000;

interface ClusterSnapshot {
  cluster: ClusterView | null;
  nodes: Node[];
  lastUpdated: Date | null;
}

const EMPTY: ClusterSnapshot = {
  cluster: null,
  nodes: [],
  lastUpdated: null,
};

export function useCluster() {
  const { active, activeKey } = useConnections();
  const hasOnline = active != null;

  const [data, setData] = useState<ClusterSnapshot>(EMPTY);
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
      // Info already carries the nodes; calling Brokers as well would run the
      // same topology query twice and double-sample the TPS history.
      const cluster = await clusterApi.getClusterView();
      if (cancelledRef.current || generation !== requestGenerationRef.current)
        return;
      setData({
        cluster,
        nodes: (cluster?.nodes?.filter(Boolean) as Node[]) ?? [],
        lastUpdated: new Date(),
      });
    } catch (e) {
      if (
        !cancelledRef.current &&
        generation === requestGenerationRef.current
      ) {
        setError(formatErrorMessage(e));
        setData(EMPTY);
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
      setData(EMPTY);
      setLoading(false);
      return () => {
        cancelledRef.current = true;
        requestGenerationRef.current += 1;
      };
    }
    setData(EMPTY);
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

  return { data, loading, refreshing, error, refresh, hasOnline };
}
