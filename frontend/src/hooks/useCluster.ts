import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrokerNode, ClusterInfo } from '../../bindings/rocket-leaf/internal/model/models.js'
import * as clusterApi from '@/api/cluster'
import { useConnections } from '@/hooks/useConnections'
import { formatErrorMessage } from '@/lib/utils'

const AUTO_REFRESH_MS = 30_000

interface ClusterSnapshot {
  cluster: ClusterInfo | null
  brokers: BrokerNode[]
  lastUpdated: Date | null
}

const EMPTY: ClusterSnapshot = {
  cluster: null,
  brokers: [],
  lastUpdated: null,
}

export function useCluster() {
  const { list } = useConnections()
  const hasOnline = list.some((c) => c.status === 'online')

  const [data, setData] = useState<ClusterSnapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setRefreshing(true)
    setError(null)
    try {
      // GetClusterInfo 已包含完整 brokers；避免再调用内部同样执行一次
      // GetClusterInfo 的 GetBrokers，减少 Broker 压力并防止 TPS 历史重复采样。
      const cluster = await clusterApi.getClusterInfo()
      if (cancelledRef.current) return
      setData({
        cluster,
        brokers: (cluster?.brokers?.filter(Boolean) as BrokerNode[]) ?? [],
        lastUpdated: new Date(),
      })
    } catch (e) {
      if (!cancelledRef.current) {
        setError(formatErrorMessage(e))
        setData(EMPTY)
      }
    } finally {
      if (!cancelledRef.current) {
        setLoading(false)
        if (!silent) setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    if (!hasOnline) {
      setData(EMPTY)
      setLoading(false)
      return () => {
        cancelledRef.current = true
      }
    }
    void refresh()
    const id = window.setInterval(() => void refresh({ silent: true }), AUTO_REFRESH_MS)
    return () => {
      cancelledRef.current = true
      window.clearInterval(id)
    }
  }, [hasOnline, refresh])

  return { data, loading, refreshing, error, refresh, hasOnline }
}
