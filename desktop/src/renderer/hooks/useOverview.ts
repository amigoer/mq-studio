import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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

interface OverviewContextValue {
  data: OverviewSnapshot
  loading: boolean
  refreshing: boolean
  error: string | null
  refresh: (opts?: { silent?: boolean }) => Promise<void>
}

const OverviewContext = createContext<OverviewContextValue | null>(null)

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

function useOverviewState(): OverviewContextValue {
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
  const inFlightRef = useRef(false)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (cancelledRef.current) return
    const silent = opts?.silent === true
    // Avoid stacking behind a slow consumers.list (main-process timeout is minutes).
    if (inFlightRef.current) {
      if (!silent) setRefreshing(true)
      return
    }

    const generation = requestGenerationRef.current
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

      inFlightRef.current = true

      // Kick off all three, but commit cluster/topics as soon as they settle so the
      // subtitle clock and live TPS keep moving even when consumer enrichment is slow.
      const clusterPromise = clusterApi.getClusterInfo()
      const topicsPromise = topicApi.getTopics()
      const consumersPromise = consumerApi.getConsumerGroups()

      const [clusterResult, topicsResult] = await Promise.allSettled([
        clusterPromise,
        topicsPromise,
      ])
      if (cancelledRef.current || generation !== requestGenerationRef.current) return

      const stillActive = activeRef.current
      if (
        !stillActive ||
        stillActive.status !== 'online' ||
        connectionKeyOf(stillActive) !== connectionKeyOf(active)
      ) {
        return
      }

      setData((prev) => ({
        cluster: clusterResult.status === 'fulfilled' ? clusterResult.value : prev.cluster,
        brokers:
          clusterResult.status === 'fulfilled'
            ? ((clusterResult.value?.brokers?.filter(Boolean) as BrokerNode[]) ?? [])
            : prev.brokers,
        topics:
          topicsResult.status === 'fulfilled'
            ? (topicsResult.value.filter(Boolean) as TopicItem[])
            : prev.topics,
        consumerGroups: prev.consumerGroups,
        activeConnection: stillActive,
        lastUpdated: new Date(),
      }))

      const consumersResult = await Promise.allSettled([consumersPromise]).then(
        (results) => results[0]!,
      )
      if (cancelledRef.current || generation !== requestGenerationRef.current) return

      const activeAfterConsumers = activeRef.current
      if (
        !activeAfterConsumers ||
        activeAfterConsumers.status !== 'online' ||
        connectionKeyOf(activeAfterConsumers) !== connectionKeyOf(active)
      ) {
        return
      }

      setData((prev) => ({
        ...prev,
        consumerGroups:
          consumersResult.status === 'fulfilled'
            ? (consumersResult.value.filter(Boolean) as ConsumerGroupItem[])
            : prev.consumerGroups,
        activeConnection: activeAfterConsumers,
        lastUpdated: new Date(),
      }))

      const firstFailure = [clusterResult, topicsResult, consumersResult].find(
        (result) => result.status === 'rejected',
      )
      if (firstFailure && firstFailure.status === 'rejected') {
        setError(formatErrorMessage(firstFailure.reason))
      }
    } catch (e) {
      if (!cancelledRef.current && generation === requestGenerationRef.current) {
        setError(formatErrorMessage(e))
      }
    } finally {
      if (generation === requestGenerationRef.current) {
        inFlightRef.current = false
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  // Re-run when the active connection identity/status changes (not on every
  // connections list poll, which only produces new object references).
  useEffect(() => {
    cancelledRef.current = false
    requestGenerationRef.current += 1
    inFlightRef.current = false
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
      inFlightRef.current = false
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

export function OverviewProvider({ children }: { children: ReactNode }) {
  return createElement(OverviewContext.Provider, { value: useOverviewState() }, children)
}

/** Shared overview snapshot + poller. Must be used within OverviewProvider. */
export function useOverview(): OverviewContextValue {
  const context = useContext(OverviewContext)
  if (!context) {
    throw new Error('useOverview must be used within OverviewProvider')
  }
  return context
}
