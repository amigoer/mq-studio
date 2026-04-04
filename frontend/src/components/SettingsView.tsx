import { useCallback, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import {
  Monitor,
  Sun,
  Moon,
  Laptop,
  Terminal,
  LayoutGrid,
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
import { useTheme, type ThemeMode } from '@/hooks/useTheme'
import {
  useSettings,
  type Language,
  type Timezone,
  type TimestampFormat,
  type ProxyType,
  type FetchLimit,
} from '@/hooks/useSettings'

import logoUrl from '@/assets/logo.png'

const APP_VERSION = __APP_VERSION__
const GITHUB_URL = 'https://github.com/codermast/rocket-leaf'
const GITHUB_ISSUES_URL = 'https://github.com/codermast/rocket-leaf/issues'
const GITHUB_RELEASES_URL = 'https://github.com/codermast/rocket-leaf/releases/latest'

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

const DATA_PATHS: { platform: string; path: string; icon: React.ElementType }[] = [
  { platform: 'macOS', path: '~/Library/Application Support/rocket-leaf/', icon: Laptop },
  { platform: 'Linux', path: '~/.config/rocket-leaf/', icon: Terminal },
  { platform: 'Windows', path: '%AppData%\\rocket-leaf\\', icon: LayoutGrid },
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-4">
      <span className="w-44 shrink-0 text-[0.9375rem] text-foreground">{label}</span>
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
        'rounded-md border border-border/50 bg-background px-3 py-2 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border',
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
  const buttonClass = cn(
    'relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-all duration-200',
    checked ? 'border-success/50 bg-success' : 'border-border/50 bg-muted'
  )
  const thumbClass = cn(
    'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full shadow-sm transition-all duration-200',
    checked
      ? 'left-[calc(100%-1.125rem)] bg-success-foreground border border-success/30'
      : 'left-0.5 bg-muted-foreground/80'
  )
  return checked ? (
    <button
      type="button"
      role="switch"
      aria-checked="true"
      title={title}
      onClick={() => onChange(!checked)}
      className={buttonClass}
    >
      <span className={thumbClass} />
    </button>
  ) : (
    <button
      type="button"
      role="switch"
      aria-checked="false"
      title={title}
      onClick={() => onChange(!checked)}
      className={buttonClass}
    >
      <span className={thumbClass} />
    </button>
  )
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')
  const { mode, setTheme } = useTheme()
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
            <div className="flex rounded-md border border-border/40 bg-background p-0.5">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors first:rounded-l-md last:rounded-r-md',
                    mode === value ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
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
              className="rounded-md border border-border/50 bg-background px-3 py-2 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border min-w-[260px]"
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
                className="rounded-md border border-border/50 bg-background px-3 py-2 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border min-w-[260px]"
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
                  className="rounded-md border border-border/50 bg-background px-3 py-2 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border w-[160px]"
                />
              )}
            </div>
          </Row>
          <Row label="代码字体 (Monospace)">
            <div className="flex items-center gap-2">
              <select
                value={MONOSPACE_FONTS.includes(settings.monospaceFont) ? settings.monospaceFont : '__custom__'}
                onChange={(e) => {
                  if (e.target.value === '__custom__') setSetting('monospaceFont', '')
                  else setSetting('monospaceFont', e.target.value)
                }}
                title="代码字体"
                className="rounded-md border border-border/50 bg-background px-3 py-2 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border min-w-[260px]"
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
                  className="rounded-md border border-border/50 bg-background px-3 py-2 text-[0.9375rem] text-foreground focus:outline-none focus:ring-1 focus:ring-border w-[160px]"
                />
              )}
            </div>
          </Row>
          <Row label="启动时自动连接上次集群">
            <Toggle
              checked={settings.autoConnectLast}
              onChange={(v) => setSetting('autoConnectLast', v)}
            />
          </Row>
            </div>
          )}

          {activeTab === 'connection' && (
            <div>
          <Row label="连接超时 (ms)">
            <input
              type="number"
              min={1000}
              max={30000}
              step={1000}
              value={settings.connectTimeoutMs}
              onChange={(e) => setSetting('connectTimeoutMs', Number(e.target.value) || 3000)}
              title="连接超时"
              aria-label="连接超时毫秒"
              className="w-20 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="请求超时 (ms)">
            <input
              type="number"
              min={1000}
              max={60000}
              step={1000}
              value={settings.requestTimeoutMs}
              onChange={(e) => setSetting('requestTimeoutMs', Number(e.target.value) || 5000)}
              title="请求超时"
              aria-label="请求超时毫秒"
              className="w-20 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="默认 AccessKey">
            <input
              type="text"
              value={settings.globalAccessKey}
              onChange={(e) => setSetting('globalAccessKey', e.target.value)}
              placeholder="新建连接时自动填充"
              className="w-48 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="默认 SecretKey">
            <input
              type="password"
              value={settings.globalSecretKey}
              onChange={(e) => setSetting('globalSecretKey', e.target.value)}
              placeholder="新建连接时自动填充"
              className="w-48 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="跳过 TLS 校验">
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
                  className="w-36 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
                />
              </Row>
              <Row label="代理端口">
                <input
                  type="text"
                  value={settings.proxyPort}
                  onChange={(e) => setSetting('proxyPort', e.target.value)}
                  placeholder="port"
                  className="w-20 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
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
          <Row label="JSON 自动格式化">
            <Toggle
              checked={settings.autoFormatJson}
              onChange={(v) => setSetting('autoFormatJson', v)}
            />
          </Row>
          <Row label="消息截断阈值 (KB)">
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
              className="w-20 rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </Row>
          <Row label="单页拉取数量">
            <select
              value={settings.fetchLimit}
              onChange={(e) => setSetting('fetchLimit', Number(e.target.value) as FetchLimit)}
              title="单页拉取数量"
              className="rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-border"
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
            <div>
          <div className="border-b border-border/40 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 object-contain" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Rocket-Leaf</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A lightweight, cross-platform RocketMQ client built with Go and Wails.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  一款基于 Wails 构建的轻量级、跨平台 RocketMQ 管理客户端。
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground/80">版本 {APP_VERSION}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 p-3">
            <button
              type="button"
              onClick={handleCheckUpdate}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              检查更新
            </button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              提交 Issue
            </a>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-xs font-medium text-foreground">数据存储目录</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              点击整行复制路径。
            </p>
            <div className="mt-2 overflow-hidden">
              {DATA_PATHS.map(({ platform, path, icon: Icon }) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => copyPath(path)}
                  className={cn(
                    'flex w-full items-center gap-3 px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent/40 rounded-md text-muted-foreground'
                  )}
                  title="点击复制路径"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0 w-16 font-medium">{platform}</span>
                  <code className="min-w-0 flex-1 break-all rounded bg-muted/60 py-1 px-2 font-mono text-[11px] text-foreground/90">
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
