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
import type { Connection } from '@/api/models'
import * as connectionApi from '@/api/connection'
import { formatErrorMessage } from '@/lib/utils'

const POLL_INTERVAL_MS = 30_000

interface ConnectionsContextValue {
  list: Connection[]
  active: Connection | null
  activeKey: string
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

    // On backend start, persisted state is reset to offline; restore the default connection
    // first, then load the list so "auto-connect on launch" is reflected in the UI.
    const bootstrap = async () => {
      try {
        await connectionApi.connectDefault()
      } catch {
        // Keep offline on auto-connect failure; the user can retry from the Connections page.
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

  const connections = list.filter(Boolean) as Connection[]
  const active = connections.find((connection) => connection.status === 'online') ?? null

  return {
    list: connections,
    active,
    activeKey: active ? `${active.id}:${active.endpoints}` : 'offline',
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
