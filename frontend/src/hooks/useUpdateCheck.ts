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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { checkUpdate, openExternal, type UpdateCheckResult } from '@/api/platform'
import { useSettings } from '@/hooks/useSettings'

const RELEASES_URL = 'https://github.com/amigoer/rocket-leaf/releases/latest'
const STORAGE_KEY = 'rocket-leaf:update-check'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
// Let the launch sequence — auto-connect, first cluster load — finish before
// spending anything on a check nobody is waiting for.
const STARTUP_DELAY_MS = 5000

/**
 * What earlier checks concluded, persisted so restarting the app neither
 * re-queries GitHub within the interval nor re-announces the same release.
 */
interface StoredState {
  /** Epoch millis of the last completed check, successful or not. */
  checkedAt: number
  /** Latest release seen, or '' when the running build is up to date. */
  available: string
  /** Release a toast has already announced. */
  announced: string
  /** Release whose sidebar marker the user has already looked at. */
  seen: string
}

const EMPTY_STATE: StoredState = { checkedAt: 0, available: '', announced: '', seen: '' }

function loadState(): StoredState {
  if (typeof window === 'undefined') return EMPTY_STATE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0,
      available: typeof parsed.available === 'string' ? parsed.available : '',
      announced: typeof parsed.announced === 'string' ? parsed.announced : '',
      seen: typeof parsed.seen === 'string' ? parsed.seen : '',
    }
  } catch {
    return EMPTY_STATE
  }
}

function storeState(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A full or disabled localStorage only costs the throttle and the
    // already-announced memory, so there is nothing to recover here.
  }
}

export interface RefreshOutcome {
  result: UpdateCheckResult
  /** True when this call is the first to surface this particular release. */
  firstAnnouncement: boolean
}

interface UpdateCheckContextValue {
  /** Newer release available for download, or null. */
  available: string | null
  /** Whether the sidebar should mark the update as unread. */
  unseen: boolean
  /** Called when the user reaches the page that shows the update. */
  markSeen: () => void
  /**
   * Checks now and folds the outcome into the shared state. Announcing is left
   * to the caller: the background check reports a release once, the Settings
   * button reports every outcome including "up to date".
   */
  refresh: () => Promise<RefreshOutcome>
}

const UpdateCheckContext = createContext<UpdateCheckContextValue | null>(null)

function useUpdateCheckState(): UpdateCheckContextValue {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const [state, setState] = useState<StoredState>(loadState)
  const enabled = settings.autoCheckUpdate
  // refresh() has to read and write the newest state synchronously, which the
  // state variable alone cannot do inside an async call.
  const stateRef = useRef(state)
  // The background effect must not restart when the toast text changes language.
  const translate = useRef(t)
  translate.current = t

  const commit = useCallback((next: StoredState) => {
    stateRef.current = next
    storeState(next)
    setState(next)
  }, [])

  const refresh = useCallback(async (): Promise<RefreshOutcome> => {
    const result = await checkUpdate()
    const previous = stateRef.current
    const available = result.status === 'available' ? result.latestVersion : ''
    const firstAnnouncement = available !== '' && previous.announced !== available
    commit({
      checkedAt: Date.now(),
      available,
      announced: available === '' ? previous.announced : available,
      seen: previous.seen,
    })
    return { result, firstAnnouncement }
  }, [commit])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let intervalId = 0

    const run = async () => {
      try {
        const { result, firstAnnouncement } = await refresh()
        if (cancelled || result.status !== 'available' || !firstAnnouncement) return
        // One toast per release: someone who is not ready to upgrade should not
        // be asked again on every launch. The sidebar marker carries it on.
        toast.info(
          translate.current('settings.about.updateAvailable', { version: result.latestVersion }),
          {
            description: translate.current('settings.about.updateAvailableHint'),
            action: {
              label: translate.current('settings.about.openReleases'),
              onClick: () => void openExternal(RELEASES_URL).catch(() => {}),
            },
          },
        )
      } catch {
        if (cancelled) return
        // Offline, rate-limited, or GitHub is down: stay quiet and retry on the
        // next interval rather than reporting a failure nobody asked for.
        commit({ ...stateRef.current, checkedAt: Date.now() })
      }
    }

    const elapsed = Date.now() - stateRef.current.checkedAt
    const firstDelay = Math.max(STARTUP_DELAY_MS, CHECK_INTERVAL_MS - elapsed)
    const timeoutId = window.setTimeout(() => {
      void run()
      intervalId = window.setInterval(() => void run(), CHECK_INTERVAL_MS)
    }, firstDelay)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [commit, enabled, refresh])

  const markSeen = useCallback(() => {
    const previous = stateRef.current
    if (!previous.available || previous.seen === previous.available) return
    commit({ ...previous, seen: previous.available })
  }, [commit])

  const available = state.available || null
  return {
    available,
    unseen: available != null && state.seen !== state.available,
    markSeen,
    refresh,
  }
}

export function UpdateCheckProvider({ children }: { children: ReactNode }) {
  const value = useUpdateCheckState()
  return createElement(UpdateCheckContext.Provider, { value }, children)
}

/** Reads the shared update-check state. Must be called within UpdateCheckProvider. */
export function useUpdateCheck(): UpdateCheckContextValue {
  const ctx = useContext(UpdateCheckContext)
  if (!ctx) {
    throw new Error('useUpdateCheck must be used within UpdateCheckProvider')
  }
  return ctx
}
