import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BrokerNode,
  ClusterInfo,
  Connection,
  ConsumerGroupItem,
  TopicItem,
} from '@generated/models'
import * as clusterApi from '@/api/cluster'
import * as consumerApi from '@/api/consumer'
import * as topicApi from '@/api/topic'
import { useConnections } from '@/hooks/useConnections'
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

/** Prefer the live online connection; fall back to default for offline display. */
function pickActiveConnection(list: Connection[]): Connection | null {
  const online = list.find((c) => c.status === 'online')
  if (online) return online
  return list.find((c) => c.isDefault) ?? list[0] ?? null
}

function connectionKeyOf(conn: Connection | null): string {
  if (!conn) return 'none'
  return `${conn.id}:${conn.nameServer}:${conn.status}`
}

export function useOverview() {
  const { list } = useConnections()
  // Shared connection state is the source of truth. Overview used to re-fetch
  // connections on its own and race bootstrap connectDefault(), which left the
  // home page stuck on "not connected" while the title bar already showed online.
  const activeConnection = useMemo(() => pickActiveConnection(list), [list])
  const isOnline = activeConnection?.status === 'online'
  const connectionKey = connectionKeyOf(activeConnection)

  const activeRef = useRef(activeConnection)
  activeRef.current = activeConnection
  const isOnlineRef = useRef(isOnline)
  isOnlineRef.current = isOnline

  const [data, setData] = useState<OverviewSnapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const requestGenerationRef = useRef(0)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (cancelledRef.current) return
    const generation = requestGenerationRef.current
    const silent = opts?.silent === true
    if (!silent) setRefreshing(true)
    setError(null)

    const active = activeRef.current
    const online = isOnlineRef.current

    try {
      if (!online || !active) {
        setData({
          ...EMPTY,
          activeConnection: active,
          lastUpdated: new Date(),
        })
        return
      }

      // Connected: fetch cluster-wide data in parallel.
      // GetClusterInfo already embeds brokers — avoid a second GetBrokers call.
      const [clusterResult, topicsResult, consumersResult] = await Promise.allSettled([
        clusterApi.getClusterInfo(),
        topicApi.getTopics(),
        consumerApi.getConsumerGroups(),
      ])
      if (cancelledRef.current || generation !== requestGenerationRef.current) return

      // Re-read in case the user switched connection mid-flight.
      const stillActive = activeRef.current
      if (
        !stillActive ||
        stillActive.status !== 'online' ||
        connectionKeyOf(stillActive) !== connectionKeyOf(active)
      ) {
        return
      }

      const next: OverviewSnapshot = {
        cluster: clusterResult.status === 'fulfilled' ? clusterResult.value : null,
        brokers:
          clusterResult.status === 'fulfilled'
            ? ((clusterResult.value?.brokers?.filter(Boolean) as BrokerNode[]) ?? [])
            : [],
        topics:
          topicsResult.status === 'fulfilled'
            ? (topicsResult.value.filter(Boolean) as TopicItem[])
            : [],
        consumerGroups:
          consumersResult.status === 'fulfilled'
            ? (consumersResult.value.filter(Boolean) as ConsumerGroupItem[])
            : [],
        activeConnection: stillActive,
        lastUpdated: new Date(),
      }
      setData(next)

      const firstFailure = [clusterResult, topicsResult, consumersResult].find(
        (r) => r.status === 'rejected',
      )
      if (firstFailure && firstFailure.status === 'rejected') {
        setError(formatErrorMessage(firstFailure.reason))
      }
    } catch (e) {
      if (!cancelledRef.current && generation === requestGenerationRef.current) {
        setError(formatErrorMessage(e))
      }
    } finally {
      if (!cancelledRef.current && generation === requestGenerationRef.current) {
        setLoading(false)
        if (!silent) setRefreshing(false)
      }
    }
  }, [])

  // Re-run when the active connection identity/status changes (not on every
  // connections list poll, which only produces new object references).
  useEffect(() => {
    cancelledRef.current = false
    requestGenerationRef.current += 1
    setData({
      ...EMPTY,
      activeConnection: activeRef.current,
    })
    setRefreshing(false)
    // Going online after bootstrap connectDefault should show loading, not a
    // stale "not connected" empty state.
    if (isOnlineRef.current) setLoading(true)
    void refresh()
    const id = window.setInterval(() => void refresh({ silent: true }), AUTO_REFRESH_MS)
    return () => {
      cancelledRef.current = true
      requestGenerationRef.current += 1
      window.clearInterval(id)
    }
  }, [refresh, connectionKey])

  // Keep snapshot.activeConnection aligned with shared state between full refreshes.
  useEffect(() => {
    setData((prev) => {
      if (connectionKeyOf(prev.activeConnection) === connectionKeyOf(activeConnection)) {
        // Prefer the fresher object from shared state when keys match.
        if (prev.activeConnection === activeConnection) return prev
        return { ...prev, activeConnection }
      }
      return prev
    })
  }, [activeConnection])

  return { data, loading, refreshing, error, refresh }
}
