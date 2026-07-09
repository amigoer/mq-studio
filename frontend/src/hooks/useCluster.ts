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
      const [clusterResult, brokersResult] = await Promise.allSettled([
        clusterApi.getClusterInfo(),
        clusterApi.getBrokers(),
      ])
      if (cancelledRef.current) return
      setData({
        cluster: clusterResult.status === 'fulfilled' ? clusterResult.value : null,
        brokers:
          brokersResult.status === 'fulfilled'
            ? (brokersResult.value.filter(Boolean) as BrokerNode[])
            : [],
        lastUpdated: new Date(),
      })
      const failure = [clusterResult, brokersResult].find((r) => r.status === 'rejected')
      if (failure && failure.status === 'rejected') {
        setError(formatErrorMessage(failure.reason))
      }
    } catch (e) {
      if (!cancelledRef.current) setError(formatErrorMessage(e))
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
