import { useCallback, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import {
  Monitor,
  Sun,
  Moon,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  RotateCcw,
  ExternalLink,
  Github,
  Network,
  MessageSquare,
  Settings,
  Database,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useSettings,
  type ThemeMode,
  type Language,
  type Timezone,
  type TimestampFormat,
  type ProxyType,
  type FetchLimit,
} from '@/hooks/useSettings'

import logoUrl from '@/assets/logo.png'

const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/amigoer/rocket-leaf'
const GITHUB_ISSUES_URL = 'https://github.com/amigoer/rocket-leaf/issues'
const GITHUB_RELEASES_URL = 'https://github.com/amigoer/rocket-leaf/releases/latest'

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: React.ElementType }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文（简体）' },
]

const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 17, 18]

const UI_FONT_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'PingFang SC', label: '苹方 (PingFang SC)' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'Noto Sans SC', label: 'Noto Sans SC' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' },
]

const MONOSPACE_FONTS = ['JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Cascadia Code', 'Consolas', 'Monaco', 'Menlo']

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function LinuxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" fill="currentColor" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M113.823 104.595c-1.795-1.478-3.629-2.921-5.308-4.525c-1.87-1.785-3.045-3.944-2.789-6.678c.147-1.573-.216-2.926-2.113-3.452c.446-1.154.864-1.928 1.033-2.753c.188-.92.178-1.887.204-2.834c.264-9.96-3.334-18.691-8.663-26.835c-2.454-3.748-5.017-7.429-7.633-11.066c-4.092-5.688-5.559-12.078-5.633-18.981a47.6 47.6 0 0 0-1.081-9.475C80.527 11.956 77.291 7.233 71.422 4.7c-4.497-1.942-9.152-2.327-13.901-1.084c-6.901 1.805-11.074 6.934-10.996 14.088c.074 6.885.417 13.779.922 20.648c.288 3.893-.312 7.252-2.895 10.34c-2.484 2.969-4.706 6.172-6.858 9.397c-1.229 1.844-2.317 3.853-3.077 5.931c-2.07 5.663-3.973 11.373-7.276 16.5c-1.224 1.9-1.363 4.026-.494 6.199c.225.563.363 1.429.089 1.882c-2.354 3.907-5.011 7.345-10.066 8.095c-3.976.591-4.172 1.314-4.051 5.413c.1 3.337.061 6.705-.28 10.021c-.363 3.555.008 4.521 3.442 5.373c7.924 1.968 15.913 3.647 23.492 6.854c3.227 1.365 6.465.891 9.064-1.763c2.713-2.771 6.141-3.855 9.844-3.859c6.285-.005 12.572.298 18.86.369c1.702.02 2.679.653 3.364 2.199c.84 1.893 2.26 3.284 4.445 3.526c4.193.462 8.013-.16 11.19-3.359c3.918-3.948 8.436-7.066 13.615-9.227c1.482-.619 2.878-1.592 4.103-2.648c2.231-1.922 2.113-3.146-.135-5M62.426 24.12c.758-2.601 2.537-4.289 5.243-4.801c2.276-.43 4.203.688 5.639 3.246c1.546 2.758 2.054 5.64.734 8.658c-1.083 2.474-1.591 2.707-4.123 1.868c-.474-.157-.937-.343-1.777-.652c.708-.594 1.154-1.035 1.664-1.382c1.134-.772 1.452-1.858 1.346-3.148c-.139-1.694-1.471-3.194-2.837-3.175c-1.225.017-2.262 1.167-2.4 2.915c-.086 1.089.095 2.199.173 3.589c-3.446-1.023-4.711-3.525-3.662-7.118m-12.75-2.251c1.274-1.928 3.197-2.314 5.101-1.024c2.029 1.376 3.547 5.256 2.763 7.576c-.285.844-1.127 1.5-1.716 2.241l-.604-.374c-.23-1.253-.276-2.585-.757-3.733c-.304-.728-1.257-1.184-1.919-1.762c-.622.739-1.693 1.443-1.757 2.228c-.088 1.084.477 2.28.969 3.331c.311.661 1.001 1.145 1.713 1.916l-1.922 1.51c-3.018-2.7-3.915-8.82-1.871-11.909M87.34 86.075c-.203 2.604-.5 2.713-3.118 3.098c-1.859.272-2.359.756-2.453 2.964a102 102 0 0 0-.012 7.753c.061 1.77-.537 3.158-1.755 4.393c-6.764 6.856-14.845 10.105-24.512 8.926c-4.17-.509-6.896-3.047-9.097-6.639c.98-.363 1.705-.607 2.412-.894c3.122-1.27 3.706-3.955 1.213-6.277c-1.884-1.757-3.986-3.283-6.007-4.892c-1.954-1.555-3.934-3.078-5.891-4.629c-1.668-1.323-2.305-3.028-2.345-5.188c-.094-5.182.972-10.03 3.138-14.747c1.932-4.209 3.429-8.617 5.239-12.885c.935-2.202 1.906-4.455 3.278-6.388c1.319-1.854 2.134-3.669 1.988-5.94c-.084-1.276-.016-2.562-.016-3.843l.707-.352c1.141.985 2.302 1.949 3.423 2.959c4.045 3.646 7.892 3.813 12.319.67c1.888-1.341 3.93-2.47 5.927-3.652c.497-.294 1.092-.423 1.934-.738c2.151 5.066 4.262 10.033 6.375 15c1.072 2.524 1.932 5.167 3.264 7.547c2.671 4.775 4.092 9.813 4.07 15.272c-.012 2.83.137 5.67-.081 8.482" />
    </svg>
  )
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  )
}

const DATA_PATHS: { platform: string; path: string; icon: React.ElementType }[] = [
  { platform: 'macOS', path: '~/Library/Application Support/rocket-leaf/', icon: AppleIcon },
  { platform: 'Linux', path: '~/.config/rocket-leaf/', icon: LinuxIcon },
  { platform: 'Windows', path: '%AppData%\\rocket-leaf\\', icon: WindowsIcon },
]

const TIMESTAMP_FORMAT_OPTIONS: { value: TimestampFormat; label: string }[] = [
  { value: 'datetime', label: 'YYYY-MM-DD HH:mm:ss' },
  { value: 'ms', label: '毫秒时间戳' },
]

const FETCH_LIMIT_OPTIONS = [
  { value: 32, label: '32' },
  { value: 64, label: '64' },
  { value: 128, label: '128' },
] as const

const PROXY_TYPE_OPTIONS: { value: ProxyType; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'socks5', label: 'SOCKS5' },
]

export type SettingsTabId = 'general' | 'connection' | 'message' | 'data' | 'about'

const SETTINGS_NAV: { id: SettingsTabId; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: '通用设置', icon: Settings },
  { id: 'connection', label: '连接与网络', icon: Network },
  { id: 'message', label: '消息与显示', icon: MessageSquare },
  { id: 'data', label: '数据与缓存', icon: Database },
  { id: 'about', label: '关于与更新', icon: Info },
]

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-2.5">
      <div className="w-44 shrink-0">
        <span className="text-[0.9375rem] text-foreground">{label}</span>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground/70">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  title,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  title?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      title={title}
      aria-label={title}
      className={cn(
        'h-10 rounded-md border border-border/50 bg-background px-3 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border',
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  checked,
  onChange,
  title = '切换',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200',
        checked ? 'bg-success' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  )
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')
  const { settings, setSetting, resetAllSettings, loading } = useSettings()

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success('已复制路径')
    } catch {
      toast.error('复制失败')
    }
  }, [])

  const handleExport = useCallback(async () => {
    try {
      const { exportAllConfig } = await import('@/api/settings')
      const jsonStr = await exportAllConfig()
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rocket-leaf-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('配置已导出')
    } catch {
      toast.error('导出配置失败')
    }
  }, [])
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const { importAllConfig } = await import('@/api/settings')
        await importAllConfig(text)
        toast.success('配置已导入，重启应用后生效')
      } catch {
        toast.error('导入配置失败')
      }
    }
    input.click()
  }, [])
  const handleClearCache = useCallback(async () => {
    try {
      const { clearCache } = await import('@/api/settings')
      await clearCache()
      toast.success('缓存已清理')
    } catch {
      toast.error('清理缓存失败')
    }
  }, [])
  const handleResetSettings = useCallback(async () => {
    try {
      await resetAllSettings()
      toast.success('已恢复默认设置')
    } catch {
      toast.error('恢复默认设置失败')
    }
  }, [resetAllSettings])
  const handleCheckUpdate = useCallback(() => {
    Browser.OpenURL(GITHUB_RELEASES_URL)
      .catch(() => window.open(GITHUB_RELEASES_URL, '_blank', 'noopener,noreferrer'))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border/40 px-5 py-3.5">
        <h1 className="text-sm font-semibold text-foreground">设置</h1>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 border-r border-border/40 bg-muted/20 py-2">
          {SETTINGS_NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[0.9375rem] transition-colors',
                activeTab === id
                  ? 'border-l-2 border-foreground/80 bg-accent/50 text-foreground'
                  : 'border-l-2 border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground'
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </button>
          ))}
        </nav>
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto p-4">
          <fieldset
            disabled={loading}
            aria-busy={loading}
            className={cn('min-w-0', loading && 'opacity-60')}
          >
            {loading && (
              <p className="mb-3 text-xs text-muted-foreground">设置加载中，暂时禁用编辑…</p>
            )}
          {activeTab === 'general' && (
            <div>
          <Row label="外观主题">
            <div className="flex h-10 rounded-md border border-border/40 bg-background p-0.5">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSetting('theme', value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 text-[0.9375rem] transition-colors first:rounded-l-[5px] last:rounded-r-[5px]',
                    settings.theme === value ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="多语言">
            <Select
              value={settings.language}
              options={LANGUAGE_OPTIONS}
              onChange={(v) => setSetting('language', v)}
              className="min-w-[260px]"
              title="多语言"
            />
          </Row>
          <Row label="界面字体大小">
            <select
              value={settings.fontSize}
              onChange={(e) => setSetting('fontSize', Number(e.target.value))}
              title="界面字体大小"
              className="h-10 rounded-md border border-border/50 bg-background px-3 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border min-w-[260px]"
            >
              {FONT_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </Row>
          <Row label="界面字体">
            <div className="flex items-center gap-2">
              <select
                value={UI_FONT_OPTIONS.some((o) => o.value === settings.uiFont) ? settings.uiFont : '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') setSetting('uiFont', e.target.value)
                }}
                title="界面字体"
                className="h-10 rounded-md border border-border/50 bg-background px-3 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border min-w-[260px]"
              >
                {UI_FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {!UI_FONT_OPTIONS.some((o) => o.value === settings.uiFont) && (
                  <option value="__custom__">自定义</option>
                )}
              </select>
              {!UI_FONT_OPTIONS.some((o) => o.value === settings.uiFont) && (
                <input
                  value={settings.uiFont}
                  onChange={(e) => setSetting('uiFont', e.target.value)}
                  placeholder="输入字体名称"
                  className="h-10 rounded-md border border-border/50 bg-background px-3 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border w-[160px]"
                />
              )}
            </div>
          </Row>
          <Row label="代码字体 (Monospace)" hint="消息内容、JSON 等使用的等宽字体">
            <div className="flex items-center gap-2">
              <select
                value={MONOSPACE_FONTS.includes(settings.monospaceFont) ? settings.monospaceFont : '__custom__'}
                onChange={(e) => {
                  if (e.target.value === '__custom__') setSetting('monospaceFont', '')
                  else setSetting('monospaceFont', e.target.value)
                }}
                title="代码字体"
                className="h-10 rounded-md border border-border/50 bg-background px-3 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border min-w-[260px]"
              >
                {MONOSPACE_FONTS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="__custom__">自定义</option>
              </select>
              {!MONOSPACE_FONTS.includes(settings.monospaceFont) && (
                <input
                  value={settings.monospaceFont}
                  onChange={(e) => setSetting('monospaceFont', e.target.value)}
                  placeholder="输入字体名称"
                  className="h-10 rounded-md border border-border/50 bg-background px-3 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border w-[160px]"
                />
              )}
            </div>
          </Row>
          <Row label="启动时自动连接上次集群" hint="启动应用后自动连接上次使用的集群">
            <Toggle
              checked={settings.autoConnectLast}
              onChange={(v) => setSetting('autoConnectLast', v)}
            />
          </Row>
            </div>
          )}

          {activeTab === 'connection' && (
            <div>
          <Row label="连接超时 (ms)" hint="建立 NameServer 连接的最大等待时间">
            <input
              type="number"
              min={1000}
              max={30000}
              step={1000}
              value={settings.connectTimeoutMs}
              onChange={(e) => setSetting('connectTimeoutMs', Number(e.target.value) || 3000)}
              title="连接超时"
              aria-label="连接超时毫秒"
              className="w-20 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="请求超时 (ms)" hint="查询 Topic、消费组等操作的超时时间">
            <input
              type="number"
              min={1000}
              max={60000}
              step={1000}
              value={settings.requestTimeoutMs}
              onChange={(e) => setSetting('requestTimeoutMs', Number(e.target.value) || 5000)}
              title="请求超时"
              aria-label="请求超时毫秒"
              className="w-20 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="默认 AccessKey" hint="新建连接时自动填充，加密存储">
            <input
              type="text"
              value={settings.globalAccessKey}
              onChange={(e) => setSetting('globalAccessKey', e.target.value)}
              placeholder="新建连接时自动填充"
              className="w-48 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="默认 SecretKey" hint="新建连接时自动填充，加密存储">
            <input
              type="password"
              value={settings.globalSecretKey}
              onChange={(e) => setSetting('globalSecretKey', e.target.value)}
              placeholder="新建连接时自动填充"
              className="w-48 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="跳过 TLS 校验" hint="跳过服务端证书验证，仅限测试环境">
            <Toggle
              checked={settings.skipTlsVerify}
              onChange={(v) => setSetting('skipTlsVerify', v)}
            />
          </Row>
          <Row label="启用代理">
            <Toggle
              checked={settings.proxyEnabled}
              onChange={(v) => setSetting('proxyEnabled', v)}
            />
          </Row>
          {settings.proxyEnabled && (
            <>
              <Row label="代理类型">
                <Select
                  value={settings.proxyType}
                  options={PROXY_TYPE_OPTIONS}
                  onChange={(v) => setSetting('proxyType', v)}
                  title="代理类型"
                />
              </Row>
              <Row label="代理地址">
                <input
                  type="text"
                  value={settings.proxyHost}
                  onChange={(e) => setSetting('proxyHost', e.target.value)}
                  placeholder="host"
                  className="w-36 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
                />
              </Row>
              <Row label="代理端口">
                <input
                  type="text"
                  value={settings.proxyPort}
                  onChange={(e) => setSetting('proxyPort', e.target.value)}
                  placeholder="port"
                  className="w-20 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
                />
              </Row>
            </>
          )}
            </div>
          )}

          {activeTab === 'message' && (
            <div>
          <Row label="时区">
            <Select
              value={settings.timezone}
              options={[
                { value: 'local' as Timezone, label: '本地时间' },
                { value: 'utc' as Timezone, label: 'UTC' },
              ]}
              onChange={(v) => setSetting('timezone', v)}
              title="时区"
            />
          </Row>
          <Row label="时间戳格式">
            <Select
              value={settings.timestampFormat}
              options={TIMESTAMP_FORMAT_OPTIONS}
              onChange={(v) => setSetting('timestampFormat', v)}
              title="时间戳格式"
            />
          </Row>
          <Row label="JSON 自动格式化" hint="查看消息时自动美化 JSON 内容">
            <Toggle
              checked={settings.autoFormatJson}
              onChange={(v) => setSetting('autoFormatJson', v)}
            />
          </Row>
          <Row label="消息截断阈值 (KB)" hint="超过此大小的消息内容将被截断显示">
            <input
              type="number"
              min={64}
              max={4096}
              value={Math.round(settings.maxPayloadRenderBytes / 1024)}
              onChange={(e) =>
                setSetting('maxPayloadRenderBytes', (Number(e.target.value) || 500) * 1024)
              }
              title="消息截断阈值"
              aria-label="消息截断阈值 KB"
              className="w-20 h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="单页拉取数量" hint="每次查询 Topic、消费组的数量上限">
            <select
              value={settings.fetchLimit}
              onChange={(e) => setSetting('fetchLimit', Number(e.target.value) as FetchLimit)}
              title="单页拉取数量"
              className="h-10 rounded-md border border-border/50 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            >
              {FETCH_LIMIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
            </div>
          )}

          {activeTab === 'data' && (
            <div>
          <div className="flex flex-wrap gap-2 p-3">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <Download className="h-4 w-4" />
              导出配置
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <Upload className="h-4 w-4" />
              导入配置
            </button>
            <button
              type="button"
              onClick={handleClearCache}
              className="flex items-center gap-2 rounded-md border border-destructive/50 bg-background px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              清理缓存
            </button>
            <button
              type="button"
              onClick={handleResetSettings}
              className="flex items-center gap-2 rounded-md border border-destructive/50 bg-background px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              恢复默认设置
            </button>
          </div>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="space-y-5">
          {/* App Info Card */}
          <div className="rounded-lg border border-border/40 bg-muted/10 p-5">
            <div className="flex items-start gap-4">
              <img src={logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-contain" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground">Rocket-Leaf</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  A lightweight, cross-platform RocketMQ client built with Go and Wails.
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  一款基于 Wails 构建的轻量级、跨平台 RocketMQ 管理客户端。
                </p>
                <span className="mt-2 inline-block rounded-full bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                  v{APP_VERSION}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={handleCheckUpdate}
              className="flex h-10 items-center gap-2 rounded-lg border border-border/50 bg-background px-4 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              检查更新
            </button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 items-center gap-2 rounded-lg border border-border/50 bg-background px-4 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 items-center gap-2 rounded-lg border border-border/50 bg-background px-4 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              提交 Issue
            </a>
          </div>

          {/* Data Paths */}
          <div>
            <h3 className="text-sm font-semibold text-foreground">数据存储目录</h3>
            <p className="mt-1 text-xs text-muted-foreground">点击复制对应平台的路径</p>
            <div className="mt-3 rounded-lg border border-border/40 overflow-hidden divide-y divide-border/30">
              {DATA_PATHS.map(({ platform, path, icon: Icon }) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => copyPath(path)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/30"
                  title="点击复制路径"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0 w-20 font-medium text-foreground">{platform}</span>
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">
                    {path}
                  </code>
                </button>
              ))}
            </div>
          </div>
            </div>
          )}
          </fieldset>
        </main>
      </div>
    </div>
  )
}
