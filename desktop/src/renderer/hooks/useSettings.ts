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
import { setLanguage as setI18nLanguage, type SupportedLanguage } from '@/i18n'

export type ThemeMode = 'system' | 'light' | 'dark'
export type Language = 'en' | 'zh'
export type FontSize = number
export type Timezone = 'local' | 'utc'
export type TimestampFormat = 'datetime' | 'ms'
export type ProxyType = 'http' | 'socks5'
export type FetchLimit = 32 | 64 | 128

// 前端使用的设置接口（与后端 AppSettings 字段一致）
export interface FrontendSettings {
  theme: ThemeMode
  language: Language
  fontSize: FontSize
  uiFont: string
  monospaceFont: string
  autoConnectLast: boolean
  connectTimeoutMs: number
  requestTimeoutMs: number
  globalAccessKey: string
  globalSecretKey: string
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
  connectTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  globalAccessKey: '',
  globalSecretKey: '',
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

// 将后端返回的 AppSettings 转为前端类型
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
    connectTimeoutMs: s.connectTimeoutMs || DEFAULTS.connectTimeoutMs,
    requestTimeoutMs: s.requestTimeoutMs || DEFAULTS.requestTimeoutMs,
    globalAccessKey: s.globalAccessKey ?? '',
    globalSecretKey: s.globalSecretKey ?? '',
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

// 将前端设置转为后端 AppSettings 格式（plain object）
function toBackend(s: FrontendSettings): AppSettings {
  return { ...s } as unknown as AppSettings
}

type SettingsContextValue = {
  settings: FrontendSettings
  setSetting: <K extends keyof FrontendSettings>(key: K, value: FrontendSettings[K]) => void
  resetAllSettings: () => Promise<void>
  reloadSettings: () => Promise<void>
  settlePendingSaves: () => Promise<void>
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
  // Keep Electron window chrome (avoids white hairline under macOS traffic lights).
  void window.rocketLeaf?.window.setAppearance(dark).catch(() => {})
}

function applySettingsToDocument(settings: FrontendSettings) {
  const root = document.documentElement

  // 主题
  applyTheme(settings.theme)

  // 字体大小
  const size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, settings.fontSize))
  root.style.setProperty('--app-font-size', `${size}px`)

  // UI 字体
  const uiFont = settings.uiFont.trim()
  root.style.setProperty(
    '--app-ui-font',
    !uiFont || uiFont === 'system' ? SYSTEM_FONT_STACK : `"${uiFont}", ${SYSTEM_FONT_STACK}`,
  )

  // 等宽字体
  root.style.setProperty(
    '--app-monospace-font',
    settings.monospaceFont.trim() || DEFAULTS.monospaceFont,
  )

  // 语言
  root.lang = settings.language === 'en' ? 'en' : 'zh-CN'
  setI18nLanguage(settings.language as SupportedLanguage)
}

function useSettingsStore(): SettingsContextValue {
  const [settings, setSettingsState] = useState<FrontendSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [effectiveDark, setEffectiveDark] = useState(() => getSystemDark())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSettingsRef = useRef<FrontendSettings | null>(null)
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())

  // 组件挂载时从后端加载设置，并迁移 localStorage 中的旧主题数据
  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((result) => {
        if (!cancelled && result) {
          const frontend = toFrontend(result)
          // 迁移旧 localStorage 主题到后端
          const legacyTheme = localStorage.getItem('rocket-leaf-theme')
          if (
            legacyTheme &&
            ['light', 'dark', 'system'].includes(legacyTheme) &&
            frontend.theme === 'system'
          ) {
            frontend.theme = legacyTheme as ThemeMode
            localStorage.removeItem('rocket-leaf-theme')
          }
          setSettingsState(frontend)
        }
      })
      .catch(() => {
        // 后端不可用时使用默认值
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    applySettingsToDocument(settings)
    setEffectiveDark(settings.theme === 'system' ? getSystemDark() : settings.theme === 'dark')
  }, [settings])

  // 监听系统主题变化（仅在 theme === 'system' 时响应）
  useEffect(() => {
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      applyTheme('system')
      setEffectiveDark(mq.matches)
      void window.rocketLeaf?.window.setAppearance(mq.matches).catch(() => {})
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [settings.theme])

  const enqueueSave = useCallback((next: FrontendSettings) => {
    // 所有写入严格串行，防止较早请求后完成并覆盖较新的设置。
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await updateSettings(toBackend(next))
      })
    saveChainRef.current = operation
    void operation.catch((err) => console.error('保存设置失败:', err))
    return operation
  }, [])

  // 防抖保存到后端
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
      // 确保重置是最后一次写入，避免 300ms 防抖保存把旧设置覆盖回来。
      await settlePendingSaves()
      const result = await apiResetSettings()
      if (result) {
        setSettingsState(toFrontend(result))
      }
    } catch (err) {
      console.error('重置设置失败:', err)
      throw err
    }
  }, [settlePendingSaves])

  const reloadSettings = useCallback(async () => {
    const result = await getSettings()
    if (result) setSettingsState(toFrontend(result))
  }, [])

  return {
    settings,
    setSetting,
    resetAllSettings,
    reloadSettings,
    settlePendingSaves,
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
    throw new Error('useSettings 必须在 SettingsProvider 内使用')
  }
  return context
}
