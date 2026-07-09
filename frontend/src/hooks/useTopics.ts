import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopicItem } from '../../bindings/rocket-leaf/internal/model/models.js'
import * as topicApi from '@/api/topic'
import { useConnections } from '@/hooks/useConnections'
import { formatErrorMessage } from '@/lib/utils'

const AUTO_REFRESH_MS = 30_000

export function useTopics() {
  const { list: connections } = useConnections()
  const hasOnline = connections.some((c) => c.status === 'online')

  const [topics, setTopics] = useState<TopicItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setRefreshing(true)
    setError(null)
    try {
      const raw = await topicApi.getTopics()
      if (cancelledRef.current) return
      setTopics(raw.filter(Boolean) as TopicItem[])
    } catch (e) {
      if (!cancelledRef.current) {
        setError(formatErrorMessage(e))
        setTopics([])
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
      setTopics([])
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

  return { topics, loading, refreshing, error, refresh, hasOnline }
}
