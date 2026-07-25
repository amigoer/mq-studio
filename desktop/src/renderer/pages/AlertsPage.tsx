import { useCallback, useState } from 'react'
import { AlertCircle, AlertTriangle, BellOff, Info, Settings } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { PageBody, PageToolbar } from '@/components/PageLayout'
import { SectionLabel } from '@/components/SectionLabel'
import { useAlerts, type AlertEntry, type AlertSeverity } from '@/hooks/useAlerts'
import type { NavId } from '@/layout/Sidebar'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { SlidingTabs } from '@/components/SlidingTabs'
import { EmptyState } from '@/components/EmptyState'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { type AlertRuleKey, type AlertRulePrefs } from '@/lib/alertRules'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

interface AlertsPageProps {
  onNavigate?: (id: NavId) => void
}

export function AlertsPage({ onNavigate }: AlertsPageProps) {
  const { t } = useTranslation()
  const { alerts, rules, toggleRule, refresh, loading, hasOnline, lagThreshold, diskThreshold } =
    useAlerts()
  const [tab, setTab] = useState<'active' | 'rules'>('active')
  const doRefresh = useCallback(() => refresh({ silent: true }), [refresh])
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  const subtitle = !hasOnline
    ? t('alerts.subtitleNoConn')
    : t('alerts.subtitle', { count: alerts.length })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('alerts.title')} subtitle={subtitle}>
        <RefreshButton spinning={isRefreshing} disabled={!hasOnline} onClick={handleRefresh} />
      </PageHeader>

      {hasOnline && (
        <PageToolbar>
          <SlidingTabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'active', label: t('alerts.tabs.active') },
              { key: 'rules', label: t('alerts.tabs.rules') },
            ]}
          />
        </PageToolbar>
      )}

      <PageBody width="content">
        {!hasOnline ? (
          <OfflineEmpty
            message={t('alerts.subtitleNoConn')}
            onAction={() => onNavigate?.('connections')}
          />
        ) : tab === 'active' ? (
          <ActiveAlerts alerts={alerts} loading={loading} />
        ) : (
          <RulesPanel
            lagThreshold={lagThreshold}
            diskThreshold={diskThreshold}
            rules={rules}
            onToggle={toggleRule}
            onOpenSettings={() => onNavigate?.('settings')}
          />
        )}
      </PageBody>
    </div>
  )
}

function severityIcon(s: AlertSeverity) {
  if (s === 'crit') return <AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} />
  if (s === 'warn') return <AlertTriangle size={13} style={{ color: 'hsl(var(--warning))' }} />
  return <Info size={13} style={{ color: 'hsl(var(--info))' }} />
}

function LevelBadge({ severity }: { severity: AlertSeverity }) {
  const { t } = useTranslation()
  const variant = severity === 'crit' ? 'destructive' : severity === 'warn' ? 'warning' : 'info'
  return (
    <Badge variant={variant} uppercase>
      {t(`alerts.level.${severity}`)}
    </Badge>
  )
}

function ActiveAlerts({ alerts, loading }: { alerts: AlertEntry[]; loading: boolean }) {
  const { t } = useTranslation()
  if (loading && alerts.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center" style={{ padding: 60, gap: 8 }}>
        <Spinner size={14} />
        <span className="text-fs-12">{t('common.loading')}</span>
      </div>
    )
  }
  if (alerts.length === 0) {
    return (
      <Card>
        <EmptyState icon={BellOff} title={t('alerts.active.empty')} />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      {alerts.map((a, i) => (
        <div
          key={a.key}
          className="flex items-start gap-2.5 transition-colors hover:bg-muted"
          style={{
            padding: '11px 14px',
            borderTop: i ? '1px solid hsl(var(--border))' : undefined,
          }}
        >
          <span className="mt-px">
            <LevelBadge severity={a.severity} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-fs-125 font-medium leading-snug">{a.title}</div>
            <div className="text-muted-foreground mt-0.5 text-fs-115 leading-snug">{a.desc}</div>
          </div>
          {a.since && (
            <span className="font-mono-design text-muted-foreground shrink-0 text-fs-11 tabular-nums">
              {t('alerts.active.since', { time: a.since })}
            </span>
          )}
        </div>
      ))}
    </Card>
  )
}

function RulesPanel({
  lagThreshold,
  diskThreshold,
  rules,
  onToggle,
  onOpenSettings,
}: {
  lagThreshold: number
  diskThreshold: number
  rules: AlertRulePrefs
  onToggle: (key: AlertRuleKey) => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card style={{ padding: 20 }}>
      <div className="text-fs-13 font-medium">{t('alerts.rules.title')}</div>
      <div className="text-muted-foreground mt-1 text-fs-12" style={{ lineHeight: 1.5 }}>
        {t('alerts.rules.desc')}
      </div>
      <div className="text-muted-foreground mt-2 text-fs-11" style={{ lineHeight: 1.5 }}>
        {t('alerts.rules.localOnlyNote')}
      </div>

      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div
          style={{
            padding: 12,
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
          }}
        >
          <div className="text-muted-foreground text-fs-12">{t('alerts.rules.lagThreshold')}</div>
          <div className="tabular-nums mt-1 text-fs-18 font-semibold">
            {lagThreshold <= 0
              ? t('alerts.rules.thresholdOff')
              : t('alerts.rules.lagThresholdValue', { n: lagThreshold.toLocaleString() })}
          </div>
        </div>
        <div
          style={{
            padding: 12,
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
          }}
        >
          <div className="text-muted-foreground text-fs-12">{t('alerts.rules.diskThreshold')}</div>
          <div className="tabular-nums mt-1 text-fs-18 font-semibold">
            {diskThreshold <= 0
              ? t('alerts.rules.thresholdOff')
              : t('alerts.rules.diskThresholdValue', { n: diskThreshold })}
          </div>
        </div>
      </div>

      <SectionLabel>{t('alerts.tabs.rules')}</SectionLabel>
      <div>
        {(['brokerOffline', 'groupOffline', 'groupLag', 'diskUsage', 'dlqGrowth'] as const).map(
          (k, i) => {
            const on = rules[k]
            return (
              <div
                key={k}
                className="flex items-center gap-3"
                style={{
                  padding: '10px 0',
                  borderTop: i ? '1px solid hsl(var(--border))' : undefined,
                }}
              >
                {severityIcon(
                  k === 'brokerOffline' || k === 'groupOffline'
                    ? 'crit'
                    : k === 'groupLag' || k === 'diskUsage'
                      ? 'warn'
                      : 'info',
                )}
                <span className="flex-1 text-fs-13">{t(`alerts.rule.${k}`)}</span>
                <Switch
                  checked={on}
                  onCheckedChange={() => onToggle(k)}
                  title={on ? t('alerts.rules.enabled') : t('alerts.rules.disabled')}
                />
              </div>
            )
          },
        )}
      </div>

      <div
        className="mt-4 flex justify-end"
        style={{ paddingTop: 12, borderTop: '1px solid hsl(var(--border))' }}
      >
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <Settings size={13} />
          {t('alerts.rules.openSettings')}
        </Button>
      </div>
    </Card>
  )
}
