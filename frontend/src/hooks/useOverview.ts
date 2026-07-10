import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BrokerNode,
  ClusterInfo,
  Connection,
  ConsumerGroupItem,
  TopicItem,
} from '../../bindings/rocket-leaf/internal/model/models.js'
import * as clusterApi from '@/api/cluster'
import * as connectionApi from '@/api/connection'
import * as consumerApi from '@/api/consumer'
import * as topicApi from '@/api/topic'
import { formatErrorMessage } from '@/lib/utils'

const AUTO_REFRESH_MS = 30_000

export interface OverviewSnapshot {
  cluster: ClusterInfo | null
  brokers: BrokerNode[]
  topics: TopicItem[]
  consumerGroups: ConsumerGroupItem[]
  activeConnection: Connection | null
  lastUpdated: Date | null
}

const EMPTY: OverviewSnapshot = {
  cluster: null,
  brokers: [],
  topics: [],
  consumerGroups: [],
  activeConnection: null,
  lastUpdated: null,
}

function pickActiveConnection(list: (Connection | null)[]): Connection | null {
  const online = list.find((c) => c && c.status === 'online') as Connection | undefined
  if (online) return online
  const def = list.find((c) => c && c.isDefault) as Connection | undefined
  return def ?? null
}

export function useOverview() {
  const [data, setData] = useState<OverviewSnapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setRefreshing(true)
    setError(null)
    try {
      // First fetch connections — cheap, no MQ traffic. Decides whether to load the rest.
      let conns: (Connection | null)[] = []
      try {
        conns = await connectionApi.getConnections()
      } catch (e) {
        if (!cancelledRef.current) setError(formatErrorMessage(e))
      }
      if (cancelledRef.current) return

      const active = pickActiveConnection(conns)
      if (!active || active.status !== 'online') {
        // No connected cluster: clear stale cluster data and bail.
        setData({ ...EMPTY, activeConnection: active, lastUpdated: new Date() })
        return
      }

      // Connected: fetch cluster-wide data in parallel.
      const [clusterResult, topicsResult, consumersResult] = await Promise.allSettled([
        clusterApi.getClusterInfo(),
        topicApi.getTopics(),
        consumerApi.getConsumerGroups(),
      ])
      if (cancelledRef.current) return

      const next: OverviewSnapshot = {
        cluster: clusterResult.status === 'fulfilled' ? clusterResult.value : null,
        brokers:
          clusterResult.status === 'fulfilled'
            ? (clusterResult.value?.brokers?.filter(Boolean) as BrokerNode[])
            : [],
        topics:
          topicsResult.status === 'fulfilled'
            ? (topicsResult.value.filter(Boolean) as TopicItem[])
            : [],
        consumerGroups:
          consumersResult.status === 'fulfilled'
            ? (consumersResult.value.filter(Boolean) as ConsumerGroupItem[])
            : [],
        activeConnection: active,
        lastUpdated: new Date(),
      }
      setData(next)

      // Surface first failure as a soft error, keep what we got.
      const firstFailure = [clusterResult, topicsResult, consumersResult].find(
        (r) => r.status === 'rejected',
      )
      if (firstFailure && firstFailure.status === 'rejected') {
        setError(formatErrorMessage(firstFailure.reason))
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
    void refresh()
    const id = window.setInterval(() => void refresh({ silent: true }), AUTO_REFRESH_MS)
    return () => {
      cancelledRef.current = true
      window.clearInterval(id)
    }
  }, [refresh])

  return { data, loading, refreshing, error, refresh }
}
