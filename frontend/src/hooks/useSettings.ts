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

export type Language = 'en' | 'zh'
export type FontSize = number
export type Timezone = 'local' | 'utc'
export type TimestampFormat = 'datetime' | 'ms'
export type ProxyType = 'http' | 'socks5'
export type FetchLimit = 32 | 64 | 128

// 前端使用的设置接口（与后端 AppSettings 字段一致）
export interface FrontendSettings {
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
  maxPayloadRenderBytes: number
  fetchLimit: FetchLimit
}

const DEFAULTS: FrontendSettings = {
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
    language: (s.language as Language) || DEFAULTS.language,
    fontSize: (typeof s.fontSize === 'number' && s.fontSize >= 12 && s.fontSize <= 18) ? s.fontSize : DEFAULTS.fontSize,
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
  loading: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'

function applySettingsToDocument(settings: FrontendSettings) {
  const root = document.documentElement
  const size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, settings.fontSize))
  root.style.setProperty('--app-font-size', `${size}px`)
  const uiFont = settings.uiFont.trim()
  root.style.setProperty(
    '--app-ui-font',
    !uiFont || uiFont === 'system' ? SYSTEM_FONT_STACK : `"${uiFont}", ${SYSTEM_FONT_STACK}`
  )
  root.style.setProperty('--app-monospace-font', settings.monospaceFont.trim() || DEFAULTS.monospaceFont)
  root.lang = settings.language === 'en' ? 'en' : 'zh-CN'
}

function useSettingsStore(): SettingsContextValue {
  const [settings, setSettingsState] = useState<FrontendSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 组件挂载时从后端加载设置
  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((result) => {
        if (!cancelled && result) {
          setSettingsState(toFrontend(result))
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
  }, [settings])

  // 防抖保存到后端
  const saveToBackend = useCallback((newSettings: FrontendSettings) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      updateSettings(toBackend(newSettings)).catch((err) => {
        console.error('保存设置失败:', err)
      })
    }, 300)
  }, [])

  const setSetting = useCallback(<K extends keyof FrontendSettings>(key: K, value: FrontendSettings[K]) => {
    setSettingsState((prev) => {
      const next = { ...prev, [key]: value }
      saveToBackend(next)
      return next
    })
  }, [saveToBackend])

  const resetAllSettings = useCallback(async () => {
    try {
      const result = await apiResetSettings()
      if (result) {
        setSettingsState(toFrontend(result))
      }
    } catch (err) {
      console.error('重置设置失败:', err)
      throw err
    }
  }, [])

  return { settings, setSetting, resetAllSettings, loading }
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
