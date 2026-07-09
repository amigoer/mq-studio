import { useCallback, useMemo } from 'react'
import { Unlink, AlertCircle, LayoutGrid, Users, Server, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  BrokerNode,
  ConsumerGroupItem,
  TopicItem,
} from '../../../bindings/rocket-leaf/internal/model/models.js'
import { PageHeader } from '../shell'
import { useOverview, type OverviewSnapshot } from '@/hooks/useOverview'
import { useSettings } from '@/hooks/useSettings'
import { useConnections } from '@/hooks/useConnections'
import * as connectionApi from '@/api/connection'
import { toast } from 'sonner'
import type { NavId } from '../Sidebar'
import { formatErrorMessage } from '@/lib/utils'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'

const HISTORY_BUCKETS = 60

function formatTps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return String(Math.round(n))
}

function formatLag(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

function formatTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function aggregateHistory(
  brokers: BrokerNode[],
  field: 'tpsInHistory' | 'tpsOutHistory',
): number[] {
  const histories = brokers
    .map((b) => (b[field] ?? []) as number[])
    .filter((h) => Array.isArray(h) && h.length > 0)
  if (histories.length === 0) return []
  const len = Math.min(HISTORY_BUCKETS, Math.max(...histories.map((h) => h.length)))
  const out = new Array<number>(len).fill(0)
  for (const h of histories) {
    const offset = Math.max(0, h.length - len)
    for (let i = 0; i < len; i++) {
      out[i] = (out[i] ?? 0) + (h[offset + i] ?? 0)
    }
  }
  return out
}

interface Issue {
  key: string
  severity: 'high' | 'med' | 'low'
  title: string
  desc: string
}

function buildIssues(
  data: OverviewSnapshot,
  lagThreshold: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Issue[] {
  const issues: Issue[] = []
  const effectiveThreshold = Math.max(1, lagThreshold)

  for (const b of data.brokers.filter((x) => x.status === 'offline').slice(0, 2)) {
    issues.push({
      key: `broker-off-${b.brokerName}`,
      severity: 'high',
      title: t('overview.ai.findings.brokerOfflineTitle', { broker: b.brokerName }),
      desc: t('overview.ai.findings.brokerOfflineDesc'),
    })
  }

  const sortedByLag = [...data.consumerGroups].sort(
    (a, b) => Number(b.lag ?? 0) - Number(a.lag ?? 0),
  )
  const noInstance = sortedByLag.find(
    (g) => Number(g.lag ?? 0) > effectiveThreshold && (g.onlineClients ?? 0) === 0,
  )
  if (noInstance) {
    issues.push({
      key: `group-off-${noInstance.group}`,
      severity: 'high',
      title: t('overview.ai.findings.offlineGroupTitle', { group: noInstance.group }),
      desc: t('overview.ai.findings.offlineGroupDesc', {
        lag: Number(noInstance.lag).toLocaleString(),
      }),
    })
  }

  const withInstance = sortedByLag.find(
    (g) =>
      Number(g.lag ?? 0) > effectiveThreshold &&
      (g.onlineClients ?? 0) > 0 &&
      g.group !== noInstance?.group,
  )
  if (withInstance) {
    issues.push({
      key: `group-lag-${withInstance.group}`,
      severity: 'high',
      title: t('overview.ai.findings.highLagTitle', {
        group: withInstance.group,
        lag: Number(withInstance.lag).toLocaleString(),
      }),
      desc: t('overview.ai.findings.highLagDesc', {
        threshold: effectiveThreshold.toLocaleString(),
      }),
    })
  }

  const heavyDisk = [...data.brokers]
    .filter((b) => Number(b.commitLogDiskUsage ?? 0) >= 75)
    .sort((a, b) => Number(b.commitLogDiskUsage ?? 0) - Number(a.commitLogDiskUsage ?? 0))[0]
  if (heavyDisk) {
    const usage = Math.round(Number(heavyDisk.commitLogDiskUsage ?? 0))
    issues.push({
      key: `disk-${heavyDisk.brokerName}`,
      severity: 'med',
      title: t('overview.ai.findings.diskTitle', { broker: heavyDisk.brokerName, usage }),
      desc: t('overview.ai.findings.diskDesc'),
    })
  }

  return issues.slice(0, 4)
}

interface OverviewScreenProps {
  onNavigate?: (id: NavId) => void
}

export function OverviewScreen({ onNavigate }: OverviewScreenProps) {
  const { t } = useTranslation()
  const { data, loading, error, refresh } = useOverview()
  const { refresh: refreshConnections } = useConnections()
  const { settings } = useSettings()
  const lagThreshold = settings.lagAlertThreshold || 10000

  const doRefresh = useCallback(
    () => Promise.all([refresh({ silent: true }), refreshConnections()]),
    [refresh, refreshConnections],
  )
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  const cluster = data.cluster
  const conn = data.activeConnection
  const isOnline = conn?.status === 'online'

  const totalLag = useMemo(
    () => data.consumerGroups.reduce((s, g) => s + Number(g.lag ?? 0), 0),
    [data.consumerGroups],
  )
  const onlineGroups = useMemo(
    () => data.consumerGroups.filter((g) => (g.onlineClients ?? 0) > 0).length,
    [data.consumerGroups],
  )
  const onlineBrokerCount = data.brokers.filter((b) => b.status === 'online').length
  const totalBrokerCount = data.brokers.length || cluster?.totalBrokers || 0

  const activeTopics = useMemo<TopicItem[]>(
    () =>
      [...data.topics]
        .filter((tp) => (tp.tpsIn ?? 0) > 0)
        .sort((a, b) => (b.tpsIn ?? 0) - (a.tpsIn ?? 0))
        .slice(0, 6),
    [data.topics],
  )
  const maxTopicTps = activeTopics[0]?.tpsIn ?? 0

  const lagAlerts = useMemo<ConsumerGroupItem[]>(
    () =>
      [...data.consumerGroups]
        .filter((g) => Number(g.lag ?? 0) > lagThreshold)
        .sort((a, b) => Number(b.lag ?? 0) - Number(a.lag ?? 0))
        .slice(0, 6),
    [data.consumerGroups, lagThreshold],
  )

  const issues = useMemo(() => buildIssues(data, lagThreshold, t), [data, lagThreshold, t])
  const tpsInSeries = useMemo(() => aggregateHistory(data.brokers, 'tpsInHistory'), [data.brokers])
  const tpsOutSeries = useMemo(
    () => aggregateHistory(data.brokers, 'tpsOutHistory'),
    [data.brokers],
  )
  const currentTpsIn = data.brokers.reduce((s, b) => s + (b.tpsIn ?? 0), 0)
  const currentTpsOut = data.brokers.reduce((s, b) => s + (b.tpsOut ?? 0), 0)

  const handleDisconnect = async () => {
    if (!conn) return
    try {
      await connectionApi.disconnect(conn.id)
      toast.success(t('overview.disconnectSuccess', { cluster: conn.name }))
      await Promise.all([refresh(), refreshConnections()])
    } catch (e) {
      toast.error(formatErrorMessage(e))
    }
  }

  const subtitle = isOnline
    ? t('overview.subtitleConnected', {
        cluster: conn?.name ?? '',
        time: formatTime(data.lastUpdated),
      })
    : t('overview.subtitleNoConn')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('overview.title')} subtitle={subtitle}>
        <RefreshButton
          variant="ghost"
          label={t('common.refresh')}
          size={13}
          spinning={isRefreshing}
          onClick={handleRefresh}
        />
        {isOnline && conn && (
          <button className="rl-btn rl-btn-outline rl-btn-sm" onClick={handleDisconnect}>
            <Unlink size={13} />
            {t('common.disconnect')}
          </button>
        )}
      </PageHeader>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 py-4">
        {!isOnline ? (
          <OfflineEmpty
            message={t('overview.current.noConnection')}
            actionLabel={t('overview.current.goToConnections')}
            onAction={() => onNavigate?.('connections')}
          />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            {error && (
              <ErrorBanner className="m-0" message={t('overview.loadError', { message: error })} />
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-2.5">
              <Kpi
                icon={LayoutGrid}
                label={t('overview.stat.topics')}
                value={(data.topics.length || cluster?.totalTopics || 0).toLocaleString()}
                hint={t('overview.stat.topicSummary', { active: activeTopics.length })}
              />
              <Kpi
                icon={Users}
                label={t('overview.stat.consumers')}
                value={(data.consumerGroups.length || cluster?.totalGroups || 0).toLocaleString()}
                hint={t('overview.stat.consumersSummary', {
                  online: onlineGroups,
                  offline: Math.max(0, data.consumerGroups.length - onlineGroups),
                })}
              />
              <Kpi
                icon={Server}
                label={t('overview.stat.broker')}
                value={`${onlineBrokerCount}/${totalBrokerCount || onlineBrokerCount}`}
                hint={
                  onlineBrokerCount === totalBrokerCount && totalBrokerCount > 0
                    ? t('overview.stat.brokerSummary_all', {
                        master: data.brokers.filter((b) =>
                          String(b.role).toUpperCase().startsWith('M'),
                        ).length,
                        slave: data.brokers.filter((b) =>
                          String(b.role).toUpperCase().startsWith('S'),
                        ).length,
                      })
                    : t('overview.stat.brokerSummary_partial', {
                        online: onlineBrokerCount,
                        total: totalBrokerCount,
                      })
                }
              />
              <Kpi
                icon={Inbox}
                label={t('overview.stat.lag')}
                value={formatLag(totalLag)}
                hint={
                  lagAlerts.length === 0
                    ? t('overview.stat.lagSummary_zero')
                    : t('overview.stat.lagSummary', { count: lagAlerts.length })
                }
              />
            </div>

            {/* Issues — only when needed */}
            {issues.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[12px] font-medium">{t('overview.issues.title')}</div>
                  <span className="rl-muted text-[11px]">
                    {t('overview.issues.count', { count: issues.length })}
                  </span>
                </div>
                <div className="rl-issue-list">
                  {issues.map((issue) => (
                    <div key={issue.key} className="rl-issue-row">
                      <span className={`rl-issue-sev ${issue.severity}`} />
                      <div className="min-w-0">
                        <div className="rl-issue-title">{issue.title}</div>
                        <div className="rl-issue-desc">{issue.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Throughput */}
            <ThroughputCard
              prod={tpsInSeries}
              cons={tpsOutSeries}
              currentIn={currentTpsIn}
              currentOut={currentTpsOut}
              loading={loading}
            />

            {/* Two lists */}
            <div className="grid grid-cols-2 gap-3">
              <ListCard
                title={t('overview.active.title')}
                subtitle={t('overview.active.subtitle')}
                empty={t('overview.active.empty')}
                onViewAll={() => onNavigate?.('topics')}
              >
                {activeTopics.map((topic) => {
                  const tps = topic.tpsIn ?? 0
                  const pct =
                    maxTopicTps > 0 ? Math.max(4, Math.round((tps / maxTopicTps) * 100)) : 0
                  return (
                    <div key={topic.topic} className="flex items-center gap-2.5 px-3 py-2">
                      <span className="font-mono-design min-w-0 flex-1 truncate text-[12px]">
                        {topic.topic}
                      </span>
                      <div className="rl-progress" style={{ width: 56 }}>
                        <div className="bar" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono-design rl-tabular rl-muted w-14 text-right text-[11.5px]">
                        {formatTps(tps)}/s
                      </span>
                    </div>
                  )
                })}
              </ListCard>

              <ListCard
                title={t('overview.lag.title')}
                subtitle={t('overview.lag.subtitle', {
                  threshold: lagThreshold.toLocaleString(),
                })}
                empty={t('overview.lag.empty')}
                badge={lagAlerts.length > 0 ? String(lagAlerts.length) : undefined}
                onViewAll={() => onNavigate?.('consumers')}
              >
                {lagAlerts.map((g) => {
                  const lag = Number(g.lag ?? 0)
                  const danger = lag > lagThreshold * 5
                  return (
                    <div key={g.group} className="flex items-center gap-2.5 px-3 py-2">
                      <AlertCircle
                        size={12}
                        className={danger ? 'text-destructive' : 'text-amber-600'}
                      />
                      <span className="font-mono-design min-w-0 flex-1 truncate text-[12px]">
                        {g.group}
                      </span>
                      <span className={`rl-badge ${danger ? 'rl-badge-danger' : 'rl-badge-warn'}`}>
                        +{lag.toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </ListCard>
            </div>

            {/* Brokers compact */}
            {data.brokers.length > 0 && (
              <section className="rl-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <div className="text-[12px] font-medium">{t('overview.broker.title')}</div>
                  <button
                    type="button"
                    className="rl-muted text-[11.5px] hover:text-foreground"
                    onClick={() => onNavigate?.('cluster')}
                  >
                    {t('common.viewAll')} →
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 p-3">
                  {[...data.brokers]
                    .sort(
                      (a, b) => a.brokerName.localeCompare(b.brokerName) || a.brokerId - b.brokerId,
                    )
                    .slice(0, 12)
                    .map((b) => {
                      const online = b.status === 'online'
                      const label = `${b.brokerName}${b.brokerId !== 0 ? `-${b.brokerId}` : ''}`
                      return (
                        <span
                          key={`${b.brokerName}-${b.brokerId}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11.5px]"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background: online
                                ? 'hsl(var(--success))'
                                : 'hsl(var(--destructive))',
                            }}
                          />
                          <span className="font-mono-design">{label}</span>
                        </span>
                      )
                    })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof LayoutGrid
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rl-stat">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <Icon size={13} className="text-muted-foreground opacity-70" />
      </div>
      <div className="value">{value}</div>
      <div className="rl-muted mt-1 text-[11px] leading-snug">{hint}</div>
    </div>
  )
}

function ThroughputCard({
  prod,
  cons,
  currentIn,
  currentOut,
  loading,
}: {
  prod: number[]
  cons: number[]
  currentIn: number
  currentOut: number
  loading: boolean
}) {
  const { t } = useTranslation()
  const hasData = prod.length > 0 || cons.length > 0
  const peak = Math.max(...prod, ...cons, 1)
  const len = Math.max(prod.length, cons.length, 1)
  const x = (i: number) => (i / Math.max(len - 1, 1)) * 800
  const y = (v: number) => 120 - (v / peak) * 100 - 8
  const lineFor = (series: number[]) => series.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const polyFor = (series: number[]) =>
    series.length ? `0,120 ${lineFor(series)} ${x(series.length - 1)},120` : ''

  return (
    <div className="rl-card p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium">{t('overview.throughput.title')}</div>
          <div className="rl-muted mt-0.5 text-[11px]">{t('overview.throughput.subtitle')}</div>
        </div>
        <div className="flex items-center gap-3">
          <Legend
            color="hsl(var(--success))"
            label={t('overview.throughput.produce')}
            value={currentIn}
          />
          <Legend
            color="hsl(var(--info))"
            label={t('overview.throughput.consume')}
            value={currentOut}
          />
        </div>
      </div>
      {hasData ? (
        <svg viewBox="0 0 800 120" preserveAspectRatio="none" className="h-[110px] w-full">
          {[30, 60, 90].map((yy) => (
            <line
              key={yy}
              x1={0}
              y1={yy}
              x2={800}
              y2={yy}
              stroke="hsl(var(--border))"
              strokeDasharray="2 4"
            />
          ))}
          {prod.length > 0 && (
            <>
              <polygon points={polyFor(prod)} fill="hsl(var(--success))" opacity={0.06} />
              <polyline
                points={lineFor(prod)}
                fill="none"
                stroke="hsl(var(--success))"
                strokeWidth={1.5}
              />
            </>
          )}
          {cons.length > 0 && (
            <polyline
              points={lineFor(cons)}
              fill="none"
              stroke="hsl(var(--info))"
              strokeWidth={1.5}
            />
          )}
        </svg>
      ) : (
        <div className="rl-muted flex h-[110px] items-center justify-center text-[12px]">
          {loading ? t('common.loading') : t('overview.throughput.noData')}
        </div>
      )}
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: color }} />
      <span className="rl-muted text-[11px]">{label}</span>
      <span className="font-mono-design rl-tabular text-[11.5px]">{formatTps(value)}/s</span>
    </div>
  )
}

function ListCard({
  title,
  subtitle,
  empty,
  badge,
  onViewAll,
  children,
}: {
  title: string
  subtitle: string
  empty: string
  badge?: string
  onViewAll?: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const items = Array.isArray(children) ? children : children ? [children] : []
  const hasItems = items.filter(Boolean).length > 0

  return (
    <div className="rl-card overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium">{title}</span>
            {badge && <span className="rl-badge rl-badge-danger">{badge}</span>}
          </div>
          <div className="rl-muted mt-0.5 text-[11px]">{subtitle}</div>
        </div>
        {onViewAll && (
          <button
            type="button"
            className="rl-muted shrink-0 text-[11.5px] hover:text-foreground"
            onClick={onViewAll}
          >
            {t('common.viewAll')}
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {hasItems ? children : <div className="rl-muted px-3 py-3 text-[12px]">{empty}</div>}
      </div>
    </div>
  )
}
