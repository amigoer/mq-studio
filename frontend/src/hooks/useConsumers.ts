import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsumerGroupItem } from '../../bindings/rocket-leaf/internal/model/models.js'
import * as consumerApi from '@/api/consumer'
import { useConnections } from '@/hooks/useConnections'
import { formatErrorMessage } from '@/lib/utils'

const AUTO_REFRESH_MS = 30_000

export function useConsumers() {
  const { list: connections } = useConnections()
  const hasOnline = connections.some((c) => c.status === 'online')

  const [groups, setGroups] = useState<ConsumerGroupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setRefreshing(true)
    setError(null)
    try {
      const raw = await consumerApi.getConsumerGroups()
      if (cancelledRef.current) return
      setGroups(raw.filter(Boolean) as ConsumerGroupItem[])
    } catch (e) {
      if (!cancelledRef.current) {
        setError(formatErrorMessage(e))
        setGroups([])
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
      setGroups([])
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

  return { groups, loading, refreshing, error, refresh, hasOnline }
}
