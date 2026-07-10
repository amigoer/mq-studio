import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Connection } from '../../bindings/rocket-leaf/internal/model/models.js'
import * as connectionApi from '@/api/connection'
import { formatErrorMessage } from '@/lib/utils'

const POLL_INTERVAL_MS = 30_000

interface ConnectionsContextValue {
  list: Connection[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null)

function useConnectionsState(): ConnectionsContextValue {
  const [list, setList] = useState<(Connection | null)[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const data = await connectionApi.getConnections()
      if (!cancelledRef.current) setList(data)
    } catch (e) {
      if (!cancelledRef.current) {
        setError(formatErrorMessage(e))
        setList([])
      }
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false

    // 后端启动时会把持久化状态重置为 offline；先执行默认连接恢复，
    // 再读取列表，确保“启动时自动连接”设置真正反映到 UI。
    const bootstrap = async () => {
      try {
        await connectionApi.connectDefault()
      } catch {
        // 自动连接失败时保留离线状态，用户仍可在连接页手动重试。
      } finally {
        await refresh()
      }
    }
    void bootstrap()
    const id = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      cancelledRef.current = true
      window.clearInterval(id)
    }
  }, [refresh])

  return {
    list: list.filter(Boolean) as Connection[],
    loading,
    error,
    refresh,
  }
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const value = useConnectionsState()
  return createElement(ConnectionsContext.Provider, { value }, children)
}

/** Reads the shared connections state. Must be called within ConnectionsProvider. */
export function useConnections(): ConnectionsContextValue {
  const ctx = useContext(ConnectionsContext)
  if (!ctx) {
    throw new Error('useConnections must be used within ConnectionsProvider')
  }
  return ctx
}
