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
import { getSettings, updateSettings, resetSettings as apiResetSettings } from '@/api/settings'
import type { AppSettings } from '@/api/settings'
import { windowControls } from '@/api/platform'
import { setLanguage as setI18nLanguage, type SupportedLanguage } from '@/i18n'

export type ThemeMode = 'system' | 'light' | 'dark'
export type Language = 'en' | 'zh'
export type FontSize = number
export type Timezone = 'local' | 'utc'
export type TimestampFormat = 'datetime' | 'ms'
export type ProxyType = 'http' | 'socks5'
export type FetchLimit = 32 | 64 | 128
export type CloseBehavior = 'minimizeToTray' | 'quit'

// Frontend settings shape (aligned with backend AppSettings fields)
export interface FrontendSettings {
  theme: ThemeMode
  language: Language
  fontSize: FontSize
  uiFont: string
  monospaceFont: string
  autoConnectLast: boolean
  autoCheckUpdate: boolean
  closeBehavior: CloseBehavior
  connectTimeoutMs: number
  requestTimeoutMs: number
  globalAccessKey: string
  globalSecretKey: string
  globalAccessKeyConfigured: boolean
  globalSecretKeyConfigured: boolean
  skipTlsVerify: boolean
  proxyEnabled: boolean
  proxyType: ProxyType
  proxyHost: string
  proxyPort: string
  timezone: Timezone
  timestampFormat: TimestampFormat
  autoFormatJson: boolean
  lagAlertThreshold: number
  diskAlertThreshold: number
  desktopNotifications: boolean
  maxPayloadRenderBytes: number
  fetchLimit: FetchLimit
}

const DEFAULTS: FrontendSettings = {
  theme: 'system',
  language: 'zh',
  fontSize: 14,
  uiFont: 'system',
  monospaceFont: 'JetBrains Mono',
  autoConnectLast: true,
  autoCheckUpdate: true,
  closeBehavior: 'minimizeToTray',
  connectTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  globalAccessKey: '',
  globalSecretKey: '',
  globalAccessKeyConfigured: false,
  globalSecretKeyConfigured: false,
  skipTlsVerify: false,
  proxyEnabled: false,
  proxyType: 'http',
  proxyHost: '',
  proxyPort: '',
  lagAlertThreshold: 10000,
  diskAlertThreshold: 75,
  desktopNotifications: false,
  timezone: 'local',
  timestampFormat: 'datetime',
  autoFormatJson: true,
  maxPayloadRenderBytes: 512 * 1024,
  fetchLimit: 64,
}

const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 18

// Map backend AppSettings to the frontend type
function toFrontend(s: AppSettings): FrontendSettings {
  return {
    theme: (['system', 'light', 'dark'].includes(s.theme) ? s.theme : DEFAULTS.theme) as ThemeMode,
    language: (s.language as Language) || DEFAULTS.language,
    fontSize:
      typeof s.fontSize === 'number' && s.fontSize >= 12 && s.fontSize <= 18
        ? s.fontSize
        : DEFAULTS.fontSize,
    uiFont: s.uiFont || DEFAULTS.uiFont,
    monospaceFont: s.monospaceFont || DEFAULTS.monospaceFont,
    autoConnectLast: s.autoConnectLast ?? DEFAULTS.autoConnectLast,
    autoCheckUpdate: s.autoCheckUpdate ?? DEFAULTS.autoCheckUpdate,
    closeBehavior: (s.closeBehavior as CloseBehavior) || DEFAULTS.closeBehavior,
    connectTimeoutMs: s.connectTimeoutMs || DEFAULTS.connectTimeoutMs,
    requestTimeoutMs: s.requestTimeoutMs || DEFAULTS.requestTimeoutMs,
    globalAccessKey: s.globalAccessKey ?? '',
    globalSecretKey: s.globalSecretKey ?? '',
    globalAccessKeyConfigured: s.globalAccessKeyConfigured ?? false,
    globalSecretKeyConfigured: s.globalSecretKeyConfigured ?? false,
    skipTlsVerify: s.skipTlsVerify ?? false,
    proxyEnabled: s.proxyEnabled ?? false,
    proxyType: (s.proxyType as ProxyType) || DEFAULTS.proxyType,
    proxyHost: s.proxyHost ?? '',
    proxyPort: s.proxyPort ?? '',
    lagAlertThreshold:
      typeof s.lagAlertThreshold === 'number' ? s.lagAlertThreshold : DEFAULTS.lagAlertThreshold,
    diskAlertThreshold:
      typeof s.diskAlertThreshold === 'number' ? s.diskAlertThreshold : DEFAULTS.diskAlertThreshold,
    desktopNotifications: s.desktopNotifications ?? DEFAULTS.desktopNotifications,
    timezone: (s.timezone as Timezone) || DEFAULTS.timezone,
    timestampFormat: (s.timestampFormat as TimestampFormat) || DEFAULTS.timestampFormat,
    autoFormatJson: s.autoFormatJson ?? DEFAULTS.autoFormatJson,
    maxPayloadRenderBytes: s.maxPayloadRenderBytes || DEFAULTS.maxPayloadRenderBytes,
    fetchLimit: (s.fetchLimit as FetchLimit) || DEFAULTS.fetchLimit,
  }
}

// Map frontend settings to backend AppSettings (plain object)
function toBackend(s: FrontendSettings): AppSettings {
  const {
    globalAccessKeyConfigured: _accessConfigured,
    globalSecretKeyConfigured: _secretConfigured,
    ...settings
  } = s
  return settings as unknown as AppSettings
}

type SettingsContextValue = {
  settings: FrontendSettings
  setSetting: <K extends keyof FrontendSettings>(key: K, value: FrontendSettings[K]) => void
  resetAllSettings: () => Promise<void>
  reloadSettings: () => Promise<void>
  settlePendingSaves: () => Promise<void>
  saveGlobalCredentials: (accessKey: string, secretKey: string) => Promise<void>
  clearGlobalCredentials: () => Promise<void>
  loading: boolean
  effectiveDark: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(mode: ThemeMode) {
  const dark = mode === 'system' ? getSystemDark() : mode === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  // Keep native window chrome in step (avoids a white hairline under the macOS traffic lights).
  void windowControls.setAppearance(dark).catch(() => {})
}

function applySettingsToDocument(settings: FrontendSettings) {
  const root = document.documentElement

  // Theme
  applyTheme(settings.theme)

  // Font size
  const size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, settings.fontSize))
  root.style.setProperty('--app-font-size', `${size}px`)

  // UI font
  const uiFont = settings.uiFont.trim()
  root.style.setProperty(
    '--app-ui-font',
    !uiFont || uiFont === 'system' ? SYSTEM_FONT_STACK : `"${uiFont}", ${SYSTEM_FONT_STACK}`,
  )

  // Monospace font
  root.style.setProperty(
    '--app-monospace-font',
    settings.monospaceFont.trim() || DEFAULTS.monospaceFont,
  )

  // Language
  root.lang = settings.language === 'en' ? 'en' : 'zh-CN'
  setI18nLanguage(settings.language as SupportedLanguage)
}

function useSettingsStore(): SettingsContextValue {
  const [settings, setSettingsState] = useState<FrontendSettings>(DEFAULTS)
  const settingsRef = useRef<FrontendSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [effectiveDark, setEffectiveDark] = useState(() => getSystemDark())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSettingsRef = useRef<FrontendSettings | null>(null)
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())

  // Load settings from backend on mount
  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((result) => {
        if (!cancelled && result) {
          setSettingsState(toFrontend(result))
        }
      })
      .catch(() => {
        // Fall back to defaults when backend is unavailable
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    settingsRef.current = settings
    applySettingsToDocument(settings)
    setEffectiveDark(settings.theme === 'system' ? getSystemDark() : settings.theme === 'dark')
  }, [settings])

  // Listen for system theme changes (only when theme === 'system')
  useEffect(() => {
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      applyTheme('system')
      setEffectiveDark(mq.matches)
      void windowControls.setAppearance(mq.matches).catch(() => {})
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [settings.theme])

  const enqueueSave = useCallback((next: FrontendSettings) => {
    // Serialize all writes so an earlier request cannot finish later and overwrite newer settings.
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await updateSettings(toBackend(next), 'preserve')
      })
    saveChainRef.current = operation
    void operation.catch((err) => console.error('Failed to save settings:', err))
    return operation
  }, [])

  // Debounced save to backend
  const saveToBackend = useCallback(
    (newSettings: FrontendSettings) => {
      pendingSettingsRef.current = newSettings
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        const pending = pendingSettingsRef.current
        pendingSettingsRef.current = null
        if (pending) void enqueueSave(pending)
      }, 300)
    },
    [enqueueSave],
  )

  const settlePendingSaves = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingSettingsRef.current
    pendingSettingsRef.current = null
    if (pending) enqueueSave(pending)
    await saveChainRef.current
  }, [enqueueSave])

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    },
    [],
  )

  const setSetting = useCallback(
    <K extends keyof FrontendSettings>(key: K, value: FrontendSettings[K]) => {
      setSettingsState((prev) => {
        const next = { ...prev, [key]: value }
        saveToBackend(next)
        return next
      })
    },
    [saveToBackend],
  )

  const resetAllSettings = useCallback(async () => {
    try {
      // Ensure reset is the last write so a pending 300ms debounced save cannot restore old settings.
      await settlePendingSaves()
      const result = await apiResetSettings()
      if (result) {
        setSettingsState(toFrontend(result))
      }
    } catch (err) {
      console.error('Failed to reset settings:', err)
      throw err
    }
  }, [settlePendingSaves])

  const reloadSettings = useCallback(async () => {
    const result = await getSettings()
    if (result) setSettingsState(toFrontend(result))
  }, [])

  const saveGlobalCredentials = useCallback(
    async (accessKey: string, secretKey: string) => {
      const trimmedAccessKey = accessKey.trim()
      if (!trimmedAccessKey || !secretKey.trim()) {
        throw new Error('AccessKey and SecretKey must both be provided')
      }
      await settlePendingSaves()
      const next = {
        ...settingsRef.current,
        globalAccessKey: trimmedAccessKey,
        globalSecretKey: secretKey,
      }
      const operation = saveChainRef.current
        .catch(() => undefined)
        .then(() => updateSettings(toBackend(next), 'replace'))
      saveChainRef.current = operation.then(
        () => undefined,
        () => undefined,
      )
      const result = await operation
      setSettingsState(toFrontend(result))
    },
    [settlePendingSaves],
  )

  const clearGlobalCredentials = useCallback(async () => {
    await settlePendingSaves()
    const next = { ...settingsRef.current, globalAccessKey: '', globalSecretKey: '' }
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(() => updateSettings(toBackend(next), 'clear'))
    saveChainRef.current = operation.then(
      () => undefined,
      () => undefined,
    )
    const result = await operation
    setSettingsState(toFrontend(result))
  }, [settlePendingSaves])

  return {
    settings,
    setSetting,
    resetAllSettings,
    reloadSettings,
    settlePendingSaves,
    saveGlobalCredentials,
    clearGlobalCredentials,
    loading,
    effectiveDark,
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettingsStore()
  return createElement(SettingsContext.Provider, { value }, children)
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context == null) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return context
}
