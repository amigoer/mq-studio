import { useCallback, useEffect, useState } from 'react'
import { PageTransition } from '@/components/PageTransition'
import {
  Sun,
  Settings as SettingsIcon,
  Type,
  MessageSquare,
  Globe,
  Database,
  Info,
  Check,
  Download,
  Upload,
  Trash2,
  RotateCcw,
  RefreshCw,
  Github,
  ExternalLink,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IconType } from 'react-icons'
import { FaApple, FaLinux, FaWindows } from 'react-icons/fa'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { PageBody } from '@/components/PageLayout'
import { navItemClass } from '@/layout/Sidebar'
import { SectionLabel } from '@/components/SectionLabel'
import {
  useSettings,
  type ThemeMode,
  type Language,
  type Timezone,
  type TimestampFormat,
  type FetchLimit,
  type CloseBehavior,
} from '@/hooks/useSettings'
import { useUIPrefs } from '@/hooks/useUIPrefs'
import { cn, withMinDuration } from '@/lib/utils'
import { REFRESH_SPIN_MS } from '@/components/RefreshButton'
import { activatableRowProps, ROW_FOCUS_CLASS } from '@/lib/a11y'
import { useConnections } from '@/hooks/useConnections'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import * as connectionApi from '@/api/connection'
import { appVersion as fetchAppVersion, openExternal } from '@/api/platform'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import logoUrl from '@/assets/logo.png'
import {
  exportAllConfigToFile,
  importAllConfigFromFile,
  clearCache as clearCacheApi,
} from '@/api/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

const GITHUB_URL = 'https://github.com/amigoer/rocket-leaf'
const GITHUB_ISSUES_URL = 'https://github.com/amigoer/rocket-leaf/issues'
const GITHUB_RELEASES_URL = 'https://github.com/amigoer/rocket-leaf/releases/latest'

type SectionId = 'appearance' | 'general' | 'fonts' | 'message' | 'proxy' | 'data' | 'about'

const SECTIONS: { id: SectionId; icon: LucideIcon }[] = [
  { id: 'appearance', icon: Sun },
  { id: 'general', icon: SettingsIcon },
  { id: 'fonts', icon: Type },
  { id: 'message', icon: MessageSquare },
  { id: 'proxy', icon: Globe },
  { id: 'data', icon: Database },
  { id: 'about', icon: Info },
]

const THEMES: { mode: ThemeMode; nameKey: string; descKey: string }[] = [
  {
    mode: 'light',
    nameKey: 'settings.appearance.themes.light',
    descKey: 'settings.appearance.themes.lightDesc',
  },
  {
    mode: 'dark',
    nameKey: 'settings.appearance.themes.dark',
    descKey: 'settings.appearance.themes.darkDesc',
  },
  {
    mode: 'system',
    nameKey: 'settings.appearance.themes.system',
    descKey: 'settings.appearance.themes.systemDesc',
  },
]

const FETCH_LIMITS: FetchLimit[] = [32, 64, 128]

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
]

const DATA_PATHS: {
  platform: string
  path: string
  Icon: IconType
}[] = [
  {
    platform: 'macOS',
    path: '~/Library/Application Support/rocket-leaf/',
    Icon: FaApple,
  },
  {
    platform: 'Linux',
    path: '~/.config/rocket-leaf/',
    Icon: FaLinux,
  },
  {
    platform: 'Windows',
    path: '%AppData%\\rocket-leaf\\',
    Icon: FaWindows,
  },
]

const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 18

type Palette = {
  bg: string
  panel: string
  border: string
  fg: string
  muted: string
  line: string
}
const LIGHT_P: Palette = {
  bg: '#ffffff',
  panel: '#fafafa',
  border: '#e5e5e5',
  fg: '#0a0a0a',
  muted: '#a3a3a3',
  line: '#f0f0f0',
}
const DARK_P: Palette = {
  bg: '#0a0a0a',
  panel: '#141414',
  border: '#262626',
  fg: '#fafafa',
  muted: '#737373',
  line: '#262626',
}

function MiniAppChrome({ p, half }: { p: Palette; half?: 'left' | 'right' }) {
  const sidebarW = half === 'right' ? 0 : 18
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
      {half !== 'right' && (
        <div
          style={{
            width: sidebarW,
            background: p.panel,
            borderRight: '1px solid ' + p.border,
            padding: '6px 3px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ height: 3, background: p.fg, opacity: 0.85, borderRadius: 1 }} />
          <div style={{ height: 3, background: p.muted, opacity: 0.5, borderRadius: 1 }} />
          <div style={{ height: 3, background: p.muted, opacity: 0.5, borderRadius: 1 }} />
        </div>
      )}
      <div
        style={{
          flex: 1,
          background: p.bg,
          padding: '6px 6px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <div style={{ width: 14, height: 3, background: p.fg, opacity: 0.9, borderRadius: 1 }} />
          <div style={{ flex: 1 }} />
          <div
            style={{ width: 6, height: 3, background: p.muted, opacity: 0.5, borderRadius: 1 }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2.5, marginTop: 2 }}>
          <div style={{ height: 2.5, background: p.line, borderRadius: 1, width: '85%' }} />
          <div style={{ height: 2.5, background: p.line, borderRadius: 1, width: '70%' }} />
          <div style={{ height: 2.5, background: p.line, borderRadius: 1, width: '78%' }} />
        </div>
      </div>
    </div>
  )
}

// --- Tiny shared bits ---

function SettingsRow({
  title,
  hint,
  children,
  bordered = true,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  bordered?: boolean
}) {
  return (
    <div
      className={
        'flex items-center justify-between gap-4 px-4 py-3' +
        (bordered ? ' border-b border-border' : '')
      }
    >
      <div className="min-w-0 flex-1 pr-2">
        <div className="text-fs-13 font-medium">{title}</div>
        {hint && <div className="text-muted-foreground mt-1 text-fs-12">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

// =================== Section Panels ===================

function AppearancePanel() {
  const { t } = useTranslation()
  const { settings, setSetting } = useSettings()
  const { prefs, setAnimations } = useUIPrefs()
  return (
    <>
      <SectionLabel first>{t('settings.appearance.theme')}</SectionLabel>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {THEMES.map((th) => {
          const active = settings.theme === th.mode
          const palette = th.mode === 'dark' ? DARK_P : LIGHT_P
          return (
            <Card
              key={th.mode}
              onClick={() => setSetting('theme', th.mode)}
              className="transition-transform duration-150 hover:-translate-y-px"
              style={{
                padding: 0,
                overflow: 'hidden',
                borderColor: active ? 'hsl(var(--foreground))' : 'hsl(var(--border))',
                boxShadow: active ? '0 0 0 1px hsl(var(--foreground))' : undefined,
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  height: 84,
                  position: 'relative',
                  background:
                    th.mode === 'system'
                      ? 'linear-gradient(105deg, #ffffff 0%, #ffffff 49%, #262626 49%, #0a0a0a 100%)'
                      : palette.bg,
                  borderBottom: '1px solid hsl(var(--border))',
                }}
              >
                {th.mode === 'system' ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                    }}
                  >
                    <MiniAppChrome p={LIGHT_P} half="left" />
                    <MiniAppChrome p={DARK_P} half="right" />
                  </div>
                ) : (
                  <MiniAppChrome p={palette} />
                )}
              </div>
              <div className="flex items-center justify-between" style={{ padding: '10px 12px' }}>
                <div>
                  <div className="text-fs-13 font-medium" style={{ lineHeight: 1.2 }}>
                    {t(th.nameKey)}
                  </div>
                  <div className="text-muted-foreground text-fs-12" style={{ marginTop: 2 }}>
                    {t(th.descKey)}
                  </div>
                </div>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    border:
                      '1px solid ' + (active ? 'hsl(var(--foreground))' : 'hsl(var(--border))'),
                    background: active ? 'hsl(var(--foreground))' : 'transparent',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'hsl(var(--background))',
                  }}
                >
                  {active && <Check size={10} strokeWidth={3} />}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <SectionLabel>{t('settings.appearance.a11y')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.appearance.animations')}
          hint={t('settings.appearance.animationsHint')}
          bordered={false}
        >
          <Switch checked={prefs.animations} onCheckedChange={() => setAnimations(!prefs.animations)} />
        </SettingsRow>
      </Card>
    </>
  )
}

function GeneralPanel() {
  const { t } = useTranslation()
  const { settings, setSetting } = useSettings()
  return (
    <>
      <SectionLabel first>{t('settings.general.languageRegion')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.general.language')}
          hint={t('settings.general.languageHint')}
        >
          <Select
            style={{ width: '15.38rem' }}
            value={settings.language}
            onChange={(e) => setSetting('language', e.target.value as Language)}
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow
          title={t('settings.general.timezone')}
          hint={t('settings.general.timezoneHint')}
          bordered={false}
        >
          <Select
            style={{ width: '15.38rem' }}
            value={settings.timezone}
            onChange={(e) => setSetting('timezone', e.target.value as Timezone)}
          >
            <option value="local">{t('settings.general.tzLocal')}</option>
            <option value="utc">{t('settings.general.tzUtc')}</option>
          </Select>
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.general.startup')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.general.autoConnect')}
          hint={t('settings.general.autoConnectHint')}
          bordered={false}
        >
          <Switch checked={settings.autoConnectLast} onCheckedChange={() => setSetting('autoConnectLast', !settings.autoConnectLast)} />
        </SettingsRow>
        <SettingsRow
          title={t('settings.general.autoCheckUpdate')}
          hint={t('settings.general.autoCheckUpdateHint')}
        >
          <Switch
            checked={settings.autoCheckUpdate}
            onCheckedChange={() => setSetting('autoCheckUpdate', !settings.autoCheckUpdate)}
          />
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.general.window')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.general.closeBehavior')}
          hint={t('settings.general.closeBehaviorHint')}
          bordered={false}
        >
          <Select
            style={{ width: '15.38rem' }}
            value={settings.closeBehavior}
            onChange={(e) => setSetting('closeBehavior', e.target.value as CloseBehavior)}
          >
            <option value="minimizeToTray">{t('settings.general.closeBehaviorTray')}</option>
            <option value="quit">{t('settings.general.closeBehaviorQuit')}</option>
          </Select>
        </SettingsRow>
      </Card>
    </>
  )
}

function FontsPanel() {
  const { t } = useTranslation()
  const { settings, setSetting } = useSettings()

  const handleFontSizeChange = (delta: number) => {
    const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, settings.fontSize + delta))
    setSetting('fontSize', next)
  }

  return (
    <>
      <SectionLabel first>{t('settings.fonts.fontsTypography')}</SectionLabel>
      <Card>
        <SettingsRow title={t('settings.fonts.fontSize')} hint={t('settings.fonts.fontSizeHint')}>
          <Button variant="outline" size="icon-sm"
            onClick={() => handleFontSizeChange(-1)}
            disabled={settings.fontSize <= MIN_FONT_SIZE}
          >
            −
          </Button>
          <span
            className="font-mono-design tabular-nums text-fs-13"
            style={{ width: '3.08rem', textAlign: 'center' }}
          >
            {settings.fontSize}px
          </span>
          <Button variant="outline" size="icon-sm"
            onClick={() => handleFontSizeChange(1)}
            disabled={settings.fontSize >= MAX_FONT_SIZE}
          >
            +
          </Button>
        </SettingsRow>
        <SettingsRow title={t('settings.fonts.uiFont')} hint={t('settings.fonts.uiFontHint')}>
          <Select
            style={{ width: '15.38rem' }}
            value={settings.uiFont}
            onChange={(e) => setSetting('uiFont', e.target.value)}
          >
            <option value="system">{t('settings.fonts.systemDefault')}</option>
            <option value="Inter">Inter</option>
            <option value="PingFang SC">PingFang SC</option>
            <option value="Microsoft YaHei">Microsoft YaHei</option>
            <option value="Noto Sans SC">Noto Sans SC</option>
            <option value="HarmonyOS Sans">HarmonyOS Sans</option>
          </Select>
        </SettingsRow>
        <SettingsRow
          title={t('settings.fonts.monospaceFont')}
          hint={t('settings.fonts.monospaceFontHint')}
          bordered={false}
        >
          <Select
            style={{ width: '15.38rem' }}
            value={settings.monospaceFont}
            onChange={(e) => setSetting('monospaceFont', e.target.value)}
          >
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Fira Code">Fira Code</option>
            <option value="Source Code Pro">Source Code Pro</option>
            <option value="Cascadia Code">Cascadia Code</option>
            <option value="Menlo">Menlo</option>
            <option value="Consolas">Consolas</option>
            <option value="system">{t('settings.fonts.systemDefault')}</option>
          </Select>
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.fonts.timeDisplay')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.fonts.timeFormat')}
          hint={t('settings.fonts.timeFormatHint')}
          bordered={false}
        >
          <Select
            style={{ width: '15.38rem' }}
            value={settings.timestampFormat}
            onChange={(e) => setSetting('timestampFormat', e.target.value as TimestampFormat)}
          >
            <option value="datetime">{t('settings.fonts.tsDatetime')}</option>
            <option value="ms">{t('settings.fonts.tsMs')}</option>
          </Select>
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.fonts.preview')}</SectionLabel>
      <Card style={{ padding: 16 }}>
        <div className="text-fs-13" style={{ fontSize: settings.fontSize }}>
          {t('settings.fonts.previewSample')}
        </div>
        <div
          className="font-mono-design text-muted-foreground mt-2 text-fs-12"
          style={{ fontFamily: `"${settings.monospaceFont}", ui-monospace, monospace` }}
        >
          {'msgId: AC1A0F23000078A4F0B8C1234E2F0001'}
        </div>
      </Card>
    </>
  )
}

function MessagePanel() {
  const { t } = useTranslation()
  const { settings, setSetting } = useSettings()
  const payloadKB = Math.round(settings.maxPayloadRenderBytes / 1024)
  return (
    <>
      <SectionLabel first>{t('settings.message.defaults')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.message.fetchLimit')}
          hint={t('settings.message.fetchLimitHint')}
        >
          <Select
            style={{ width: '10.77rem' }}
            value={settings.fetchLimit}
            onChange={(e) => setSetting('fetchLimit', Number(e.target.value) as FetchLimit)}
          >
            {FETCH_LIMITS.map((n) => (
              <option key={n} value={n}>
                {t('settings.message.fetchUnit', { count: n })}
              </option>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow
          title={t('settings.message.autoFormatJson')}
          hint={t('settings.message.autoFormatJsonHint')}
        >
          <Switch checked={settings.autoFormatJson} onCheckedChange={() => setSetting('autoFormatJson', !settings.autoFormatJson)} />
        </SettingsRow>
        <SettingsRow
          title={t('settings.message.payloadLimit')}
          hint={t('settings.message.payloadLimitHint')}
          bordered={false}
        >
          <Input
            type="number"
            style={{ width: '7.69rem' }}
            min={64}
            max={4096}
            value={payloadKB}
            onChange={(e) =>
              setSetting('maxPayloadRenderBytes', (Number(e.target.value) || 500) * 1024)
            }
            onBlur={() => {
              const kb = Math.max(
                64,
                Math.min(4096, Math.round(settings.maxPayloadRenderBytes / 1024)),
              )
              setSetting('maxPayloadRenderBytes', kb * 1024)
            }}
          />
          <span className="text-muted-foreground text-fs-12">KB</span>
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.message.alertThresholds')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.message.lagAlert')}
          hint={t('settings.message.lagAlertHint')}
        >
          <Input
            type="number"
            style={{ width: '9.23rem' }}
            min={0}
            step={1000}
            value={settings.lagAlertThreshold}
            onChange={(e) => setSetting('lagAlertThreshold', Number(e.target.value) || 0)}
          />
          <span className="text-muted-foreground text-fs-12">{t('settings.message.lagAlertUnit')}</span>
        </SettingsRow>
        <SettingsRow
          title={t('settings.message.diskAlert')}
          hint={t('settings.message.diskAlertHint')}
        >
          <Input
            type="number"
            style={{ width: '7.69rem' }}
            min={0}
            max={100}
            step={5}
            value={settings.diskAlertThreshold}
            onChange={(e) => {
              const n = Number(e.target.value)
              setSetting(
                'diskAlertThreshold',
                Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0,
              )
            }}
          />
          <span className="text-muted-foreground text-fs-12">{t('settings.message.diskAlertUnit')}</span>
        </SettingsRow>
        <SettingsRow
          title={t('settings.message.desktopNotifications')}
          hint={t('settings.message.desktopNotificationsHint')}
          bordered={false}
        >
          <Switch
            checked={settings.desktopNotifications}
            onCheckedChange={(next) => {
              if (
                next &&
                typeof Notification !== 'undefined' &&
                Notification.permission === 'default'
              ) {
                void Notification.requestPermission().then((perm) => {
                  setSetting('desktopNotifications', perm === 'granted')
                })
                return
              }
              setSetting('desktopNotifications', next)
            }}
          />
        </SettingsRow>
      </Card>
    </>
  )
}

function ProxyPanel() {
  const { t } = useTranslation()
  const { settings, setSetting, saveGlobalCredentials, clearGlobalCredentials } = useSettings()
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [credentialsBusy, setCredentialsBusy] = useState<'save' | 'clear' | null>(null)
  const credentialsConfigured =
    settings.globalAccessKeyConfigured && settings.globalSecretKeyConfigured

  useEffect(() => {
    setAccessKey('')
    setSecretKey('')
  }, [settings.globalAccessKeyConfigured, settings.globalSecretKeyConfigured])

  const handleSaveCredentials = async () => {
    if (!accessKey.trim() || !secretKey.trim()) {
      toast.error(t('settings.proxy.credentialsPairRequired'))
      return
    }
    setCredentialsBusy('save')
    try {
      await saveGlobalCredentials(accessKey, secretKey)
      toast.success(t('settings.proxy.credentialsSaved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.proxy.credentialsSaveError'))
    } finally {
      setCredentialsBusy(null)
    }
  }

  const handleClearCredentials = async () => {
    setCredentialsBusy('clear')
    try {
      await clearGlobalCredentials()
      toast.success(t('settings.proxy.credentialsCleared'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.proxy.credentialsClearError'))
    } finally {
      setCredentialsBusy(null)
    }
  }
  return (
    <>
      <SectionLabel first>{t('settings.proxy.timeout')}</SectionLabel>
      <Card>
        <SettingsRow title={t('settings.proxy.connect')} hint={t('settings.proxy.connectHint')}>
          <Input
            type="number"
            style={{ width: '7.69rem' }}
            min={1000}
            max={30000}
            step={1000}
            value={settings.connectTimeoutMs}
            onChange={(e) => setSetting('connectTimeoutMs', Number(e.target.value) || 3000)}
            onBlur={() =>
              setSetting(
                'connectTimeoutMs',
                Math.max(1000, Math.min(30000, settings.connectTimeoutMs)),
              )
            }
          />
          <span className="text-muted-foreground text-fs-12">ms</span>
        </SettingsRow>
        <SettingsRow
          title={t('settings.proxy.request')}
          hint={t('settings.proxy.requestHint')}
          bordered={false}
        >
          <Input
            type="number"
            style={{ width: '7.69rem' }}
            min={1000}
            max={60000}
            step={1000}
            value={settings.requestTimeoutMs}
            onChange={(e) => setSetting('requestTimeoutMs', Number(e.target.value) || 5000)}
            onBlur={() =>
              setSetting(
                'requestTimeoutMs',
                Math.max(1000, Math.min(60000, settings.requestTimeoutMs)),
              )
            }
          />
          <span className="text-muted-foreground text-fs-12">ms</span>
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.proxy.credentials')}
        <Badge variant="outline" className="ml-2 normal-case tracking-normal">
          {credentialsConfigured
            ? t('settings.proxy.credentialsConfigured')
            : t('settings.proxy.credentialsNotConfigured')}
        </Badge></SectionLabel>
      <Card>
        <SettingsRow title={t('settings.proxy.ak')} hint={t('settings.proxy.akHint')}>
          <Input
            type="text"
            className="font-mono-design"
            style={{ width: '18.46rem' }}
            value={accessKey}
            placeholder={
              credentialsConfigured
                ? t('settings.proxy.credentialsReplacePlaceholder')
                : t('settings.proxy.akPlaceholder')
            }
            onChange={(e) => setAccessKey(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          title={t('settings.proxy.sk')}
          hint={t('settings.proxy.skHint')}
        >
          <Input
            type="password"
            className="font-mono-design"
            style={{ width: '18.46rem' }}
            value={secretKey}
            placeholder={
              credentialsConfigured
                ? t('settings.proxy.credentialsReplacePlaceholder')
                : t('settings.proxy.skPlaceholder')
            }
            onChange={(e) => setSecretKey(e.target.value)}
          />
        </SettingsRow>
        <div className="flex justify-end gap-2 px-4 py-3">
          {credentialsConfigured && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={credentialsBusy != null}
              onClick={() => void handleClearCredentials()}
            >
              {t('settings.proxy.clearCredentials')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={credentialsBusy != null || !accessKey.trim() || !secretKey.trim()}
            onClick={() => void handleSaveCredentials()}
          >
            {credentialsConfigured
              ? t('settings.proxy.replaceCredentials')
              : t('settings.proxy.saveCredentials')}
          </Button>
        </div>
      </Card>

      <SectionLabel>{t('settings.proxy.advanced')}</SectionLabel>
      <Card>
        <div className="text-muted-foreground text-fs-12" style={{ padding: '12px 16px', lineHeight: 1.55 }}>
          {t('settings.proxy.unsupportedNote')}
        </div>
        <SettingsRow title={t('settings.proxy.skipTls')} hint={t('settings.proxy.skipTlsHint')}>
          <Badge variant="outline">{t('settings.proxy.notAvailable')}</Badge>
        </SettingsRow>
        <SettingsRow
          title={t('settings.proxy.enable')}
          hint={t('settings.proxy.enableHint')}
          bordered={false}
        >
          <Badge variant="outline">{t('settings.proxy.notAvailable')}</Badge>
        </SettingsRow>
      </Card>
    </>
  )
}

function DataPanel({
  onExport,
  onImport,
  onClearCache,
}: {
  onExport: () => void
  onImport: () => void
  onClearCache: () => void
}) {
  const { t } = useTranslation()
  const copyPath = useCallback(
    async (p: string) => {
      try {
        await navigator.clipboard.writeText(p)
        toast.success(t('settings.data.copySuccess'))
      } catch {
        toast.error(t('settings.data.copyError'))
      }
    },
    [t],
  )

  return (
    <>
      <SectionLabel first>{t('settings.data.storage')}</SectionLabel>
      <Card className="overflow-hidden">
        {DATA_PATHS.map((p, i) => {
          const Icon = p.Icon
          return (
            <div
              key={p.platform}
              role="button"
              aria-label={`${p.platform} ${p.path}`}
              className={cn('flex cursor-pointer items-center gap-3 hover:bg-muted/40', ROW_FOCUS_CLASS)}
              style={{
                padding: '10px 16px',
                borderTop: i ? '1px solid hsl(var(--border))' : undefined,
              }}
              onClick={() => copyPath(p.path)}
              {...activatableRowProps(() => void copyPath(p.path))}
            >
              <Icon size={14} className="text-muted-foreground shrink-0" aria-hidden />
              <span className="text-fs-13 font-medium" style={{ width: '6.15rem' }}>
                {p.platform}
              </span>
              <code className="font-mono-design text-muted-foreground min-w-0 flex-1 truncate text-fs-12">
                {p.path}
              </code>
              <span className="text-muted-foreground text-fs-11">{t('settings.data.clickToCopy')}</span>
            </div>
          )
        })}
      </Card>

      <SectionLabel>{t('settings.data.ioSection')}</SectionLabel>
      <Card>
        <SettingsRow title={t('settings.data.exportTitle')} hint={t('settings.data.exportHint')}>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download size={13} />
            {t('common.export')}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={t('settings.data.importTitle')}
          hint={t('settings.data.importHint')}
          bordered={false}
        >
          <Button variant="outline" size="sm" onClick={onImport}>
            <Upload size={13} />
            {t('common.selectFile')}
          </Button>
        </SettingsRow>
      </Card>

      <SectionLabel>{t('settings.data.cleanup')}</SectionLabel>
      <Card>
        <SettingsRow
          title={t('settings.data.clearCache')}
          hint={t('settings.data.clearCacheHint')}
          bordered={false}
        >
          <Button variant="outline" size="sm"
            style={{
              color: 'hsl(var(--destructive))',
              borderColor: 'hsl(var(--destructive) / 0.5)',
            }}
            onClick={onClearCache}
          >
            <Trash2 size={13} />
            {t('settings.data.clearCache')}
          </Button>
        </SettingsRow>
      </Card>
    </>
  )
}

function AboutPanel({
  version,
  updateAvailable,
  onCheckUpdate,
  onResetSettings,
}: {
  version: string | null
  updateAvailable: string | null
  onCheckUpdate: () => void | Promise<void>
  onResetSettings: () => void
}) {
  const { t } = useTranslation()
  const openLink = (url: string) => openExternal(url).catch(() => {})

  // A check against GitHub often returns faster than the eye can register, so
  // hold the spin for one full turn — otherwise pressing the button looks like
  // nothing happened until the toast arrives.
  const [checking, setChecking] = useState(false)
  const runCheckUpdate = useCallback(async () => {
    if (checking) return
    setChecking(true)
    try {
      await withMinDuration(Promise.resolve(onCheckUpdate()), REFRESH_SPIN_MS)
    } finally {
      setChecking(false)
    }
  }, [checking, onCheckUpdate])
  const versionLabel =
    version === null ? '…' : version ? `v${version}` : t('settings.about.versionUnavailable')

  return (
    <div className="flex flex-col gap-4">
      {/* Identity + resource actions in one compact card (matches design). */}
      <Card style={{ padding: 18 }}>
        <div className="flex items-start gap-3.5">
          <img
            src={logoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg object-contain"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-fs-15 font-semibold">{t('app.name')}</h2>
              <span className="font-mono-design text-muted-foreground text-fs-115">
                {versionLabel}
              </span>
              {updateAvailable && (
                <Badge variant="success">
                  {t('settings.about.updateBadge', { version: updateAvailable })}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-fs-12" style={{ lineHeight: 1.55 }}>
              {t('settings.about.descriptionZh')}
            </p>
            <p className="text-muted-foreground text-fs-115" style={{ lineHeight: 1.5 }}>
              {t('settings.about.descriptionEn')}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => void runCheckUpdate()}
            disabled={checking}
            aria-busy={checking}
          >
            <RefreshCw
              size={13}
              className={cn('rl-refresh-icon', checking && 'rl-refresh-spin')}
            />
            {checking ? t('settings.about.checkingUpdate') : t('settings.about.checkUpdate')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => openLink(GITHUB_URL)}>
            <Github size={13} />
            GitHub
          </Button>
          <Button variant="outline" size="sm" onClick={() => openLink(GITHUB_ISSUES_URL)}>
            <ExternalLink size={13} />
            {t('settings.about.openIssue')}
          </Button>
        </div>
      </Card>

      {/* Reset — compact standalone row, no section header. */}
      <Card style={{ padding: '12px 16px' }}>
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-fs-125 font-medium">{t('settings.about.resetTitle')}</div>
            <div className="text-muted-foreground mt-0.5 text-fs-115">
              {t('settings.about.resetHint')}
            </div>
          </div>
          <Button variant="outline" size="sm"
            className="shrink-0"
            style={{
              color: 'hsl(var(--destructive))',
              borderColor: 'hsl(var(--destructive) / 0.5)',
            }}
            onClick={onResetSettings}
          >
            <RotateCcw size={13} />
            {t('settings.about.reset')}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// Settings page

export function SettingsPage() {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<SectionId>('appearance')
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const { resetAllSettings, reloadSettings, settlePendingSaves, loading } = useSettings()
  const { refresh: refreshConnections } = useConnections()
  const { available: updateAvailable, refresh: refreshUpdate } = useUpdateCheck()
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    onConfirm: () => void
  } | null>(null)

  useEffect(() => {
    let disposed = false
    void fetchAppVersion()
      .then((version) => {
        if (!disposed) setAppVersion(version)
      })
      .catch((error) => {
        console.error('[settings] failed to load application version', error)
        if (!disposed) setAppVersion('')
      })
    return () => {
      disposed = true
    }
  }, [])

  const doExport = useCallback(async () => {
    try {
      await settlePendingSaves()
      const savedPath = await exportAllConfigToFile()
      if (!savedPath) return
      toast.success(t('settings.data.exportSuccess'), { description: savedPath })
    } catch {
      toast.error(t('settings.data.exportError'))
    }
  }, [settlePendingSaves, t])

  const handleExport = useCallback(() => {
    setConfirmAction({
      title: t('settings.data.exportConfirmTitle'),
      description: t('settings.data.exportConfirmDesc'),
      onConfirm: () => {
        setConfirmAction(null)
        void doExport()
      },
    })
  }, [doExport, t])

  const handleImport = useCallback(async () => {
    try {
      await settlePendingSaves()
      const path = await importAllConfigFromFile()
      if (!path) return
      await reloadSettings()
      await connectionApi.connectDefault()
      await refreshConnections()
      toast.success(t('settings.data.importSuccess'), { description: path })
    } catch {
      toast.error(t('settings.data.importError'))
    }
  }, [refreshConnections, reloadSettings, settlePendingSaves, t])

  const doClearCache = useCallback(async () => {
    try {
      await clearCacheApi()
      toast.success(t('settings.data.clearCacheSuccess'))
    } catch {
      toast.error(t('settings.data.clearCacheError'))
    }
  }, [t])

  const handleClearCache = useCallback(() => {
    setConfirmAction({
      title: t('settings.data.clearCacheConfirmTitle'),
      description: t('settings.data.clearCacheConfirmDesc'),
      onConfirm: () => {
        setConfirmAction(null)
        void doClearCache()
      },
    })
  }, [doClearCache, t])

  const handleResetSettings = useCallback(() => {
    setConfirmAction({
      title: t('settings.about.resetConfirmTitle'),
      description: t('settings.about.resetConfirmDesc'),
      onConfirm: async () => {
        setConfirmAction(null)
        try {
          await resetAllSettings()
          toast.success(t('settings.about.resetSuccess'))
        } catch {
          toast.error(t('settings.about.resetError'))
        }
      },
    })
  }, [resetAllSettings, t])

  const handleCheckUpdate = useCallback(async () => {
    try {
      const { result } = await refreshUpdate()
      setAppVersion(result.currentVersion)
      const openReleases = {
        label: t('settings.about.openReleases'),
        onClick: () => void openExternal(GITHUB_RELEASES_URL),
      }
      if (result.status === 'available') {
        toast.info(t('settings.about.updateAvailable', { version: result.latestVersion }), {
          description: t('settings.about.updateAvailableHint'),
          action: openReleases,
        })
      } else if (result.status === 'ahead') {
        toast.info(
          t('settings.about.aheadOfRelease', {
            current: result.currentVersion,
            latest: result.latestVersion,
          }),
          { action: openReleases },
        )
      } else {
        toast.info(t('settings.about.upToDate', { version: result.currentVersion }))
      }
    } catch {
      toast.info(t('settings.about.updateCheckFailed'), {
        description: t('settings.about.openReleasesHint'),
        action: {
          label: t('settings.about.openReleases'),
          onClick: () => void openExternal(GITHUB_RELEASES_URL),
        },
      })
    }
  }, [refreshUpdate, t])

  const currentSection = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0]!

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('settings.title')} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[15.38rem] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-background p-2.5 gap-0.5">
          {SECTIONS.map((s) => {
            const active = s.id === activeSection
            return (
              <Button
                key={s.id}
                type="button"
                variant="ghost"
                size="sm"
                className={navItemClass(active)}
                onClick={() => setActiveSection(s.id)}
              >
                <s.icon
                  size={15}
                  strokeWidth={active ? 2 : 1.75}
                  className={cn('shrink-0', active ? 'opacity-100' : 'opacity-80')}
                />
                <span className="truncate">{t(`settings.section.${s.id}.label`)}</span>
              </Button>
            )
          })}
        </aside>

        <PageBody width="content" className="bg-background">
          <PageTransition
            transitionKey={activeSection}
            variant="panel"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-fs-15 font-semibold tracking-tight">
                  {t(`settings.section.${currentSection.id}.label`)}
                </div>
                <div className="text-muted-foreground mt-1 text-fs-12">
                  {t(`settings.section.${currentSection.id}.subtitle`)}
                </div>
              </div>
              <span className="text-muted-foreground shrink-0 text-fs-12">
                {loading ? t('settings.loading') : t('settings.autoSaved')}
              </span>
            </div>

            <fieldset
              disabled={loading}
              aria-busy={loading}
              className="m-0 border-0 p-0"
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {activeSection === 'appearance' && <AppearancePanel />}
              {activeSection === 'general' && <GeneralPanel />}
              {activeSection === 'fonts' && <FontsPanel />}
              {activeSection === 'message' && <MessagePanel />}
              {activeSection === 'proxy' && <ProxyPanel />}
              {activeSection === 'data' && (
                <DataPanel
                  onExport={handleExport}
                  onImport={handleImport}
                  onClearCache={handleClearCache}
                />
              )}
              {activeSection === 'about' && (
                <AboutPanel
                  version={appVersion}
                  updateAvailable={updateAvailable}
                  onCheckUpdate={handleCheckUpdate}
                  onResetSettings={handleResetSettings}
                />
              )}
            </fieldset>
          </PageTransition>
        </PageBody>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description ?? ''}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={confirmAction?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
