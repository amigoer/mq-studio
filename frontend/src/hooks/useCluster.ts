import { useCallback, useEffect, useRef, useState } from "react";
import type { BrokerNode, ClusterInfo } from "@/api/models";
import * as clusterApi from "@/api/cluster";
import { useConnections } from "@/hooks/useConnections";
import { formatErrorMessage } from "@/lib/utils";

const AUTO_REFRESH_MS = 30_000;

interface ClusterSnapshot {
  cluster: ClusterInfo | null;
  brokers: BrokerNode[];
  lastUpdated: Date | null;
}

const EMPTY: ClusterSnapshot = {
  cluster: null,
  brokers: [],
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
      // GetClusterInfo already includes full brokers; skip GetBrokers (which runs GetClusterInfo
      // again) to reduce broker load and avoid double-sampling TPS history.
      const cluster = await clusterApi.getClusterInfo();
      if (cancelledRef.current || generation !== requestGenerationRef.current)
        return;
      setData({
        cluster,
        brokers: (cluster?.brokers?.filter(Boolean) as BrokerNode[]) ?? [],
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
