import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopicItem } from '@/api/models'
import * as topicApi from '@/api/topic'
import { useConnections } from '@/hooks/useConnections'
import { formatErrorMessage } from '@/lib/utils'

const AUTO_REFRESH_MS = 30_000

export function useTopics() {
  const { active, activeKey } = useConnections()
  const hasOnline = active != null

  const [topics, setTopics] = useState<TopicItem[]>([])
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
    try {
      const raw = await topicApi.getTopics()
      if (cancelledRef.current || generation !== requestGenerationRef.current) return
      setTopics(raw.filter(Boolean) as TopicItem[])
    } catch (e) {
      if (!cancelledRef.current && generation === requestGenerationRef.current) {
        setError(formatErrorMessage(e))
        setTopics([])
      }
    } finally {
      if (!cancelledRef.current && generation === requestGenerationRef.current) {
        setLoading(false)
        if (!silent) setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    requestGenerationRef.current += 1
    if (!hasOnline) {
      setTopics([])
      setLoading(false)
      return () => {
        cancelledRef.current = true
        requestGenerationRef.current += 1
      }
    }
    setTopics([])
    setLoading(true)
    setRefreshing(false)
    void refresh()
    const id = window.setInterval(() => void refresh({ silent: true }), AUTO_REFRESH_MS)
    return () => {
      cancelledRef.current = true
      requestGenerationRef.current += 1
      window.clearInterval(id)
    }
  }, [hasOnline, activeKey, refresh])

  return { topics, loading, refreshing, error, refresh, hasOnline }
}
