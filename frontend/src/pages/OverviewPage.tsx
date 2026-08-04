import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import {
  Unlink,
  AlertCircle,
  LayoutGrid,
  Users,
  Server,
  Inbox,
  Send,
  Search,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConsumerGroupItem, TopicItem } from '@/api/models'
import { PageHeader } from '@/components/PageHeader'
import { PageBody } from '@/components/PageLayout'
import { StatCard } from '@/components/StatCard'
import { formatCompactCount, formatRate } from '@/lib/format'
import { useOverview, type OverviewSnapshot } from '@/hooks/useOverview'
import { useSettings } from '@/hooks/useSettings'
import { useConnections } from '@/hooks/useConnections'
import * as connectionApi from '@/api/connection'
import { toast } from 'sonner'
import type { NavId } from '@/layout/Sidebar'
import { cn, formatErrorMessage } from '@/lib/utils'
import {
  aggregateThroughputHistory,
  continuousHistoryRanges,
  throughputWindow,
} from '@/lib/throughputHistory'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

function formatTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
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
  diskThreshold: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Issue[] {
  const issues: Issue[] = []
  const effectiveThreshold = Math.max(0, lagThreshold)
  const effectiveDisk = Math.max(0, diskThreshold)

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
  const noInstance =
    effectiveThreshold > 0
      ? sortedByLag.find(
          (g) =>
            g.status === 'offline' &&
            Number(g.lag ?? 0) > effectiveThreshold &&
            (g.onlineClients ?? 0) === 0,
        )
      : undefined
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

  const withInstance =
    effectiveThreshold > 0
      ? sortedByLag.find(
          (g) =>
            Number(g.lag ?? 0) > effectiveThreshold &&
            (g.onlineClients ?? 0) > 0 &&
            g.group !== noInstance?.group,
        )
      : undefined
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

  if (effectiveDisk > 0) {
    const heavyDisk = [...data.brokers]
      .filter((b) => Number(b.commitLogDiskUsage ?? 0) >= effectiveDisk)
      .sort((a, b) => Number(b.commitLogDiskUsage ?? 0) - Number(a.commitLogDiskUsage ?? 0))[0]
    if (heavyDisk) {
      const usage = Math.round(Number(heavyDisk.commitLogDiskUsage ?? 0))
      issues.push({
        key: `disk-${heavyDisk.brokerName}`,
        severity: 'med',
        title: t('overview.ai.findings.diskTitle', { broker: heavyDisk.brokerName, usage }),
        desc: t('overview.ai.findings.diskDesc', { threshold: effectiveDisk }),
      })
    }
  }

  return issues.slice(0, 4)
}

interface OverviewPageProps {
  onNavigate?: (id: NavId) => void
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const { t } = useTranslation()
  const { data, loading, error, refresh } = useOverview()
  const { list: connections, refresh: refreshConnections } = useConnections()
  const { settings } = useSettings()
  const lagThreshold = settings.lagAlertThreshold ?? 10000
  const diskThreshold = settings.diskAlertThreshold ?? 75
  const doRefresh = useCallback(
    () => Promise.all([refresh({ silent: true }), refreshConnections()]),
    [refresh, refreshConnections],
  )
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  const cluster = data.cluster
  // Title bar / sidebar use shared connection state; derive online from the same
  // source so the home page cannot stay on Offline empty after auto-connect.
  const conn =
    connections.find((c) => c.status === 'online') ??
    data.activeConnection ??
    connections.find((c) => c.isDefault) ??
    null
  const isOnline = conn?.status === 'online'

  const totalLag = useMemo(
    () =>
      data.consumerGroups.reduce((sum, group) => {
        const lag = Number(group.lag ?? -1)
        return sum + (lag >= 0 ? lag : 0)
      }, 0),
    [data.consumerGroups],
  )
  const onlineGroups = useMemo(
    () => data.consumerGroups.filter((g) => g.status === 'online').length,
    [data.consumerGroups],
  )
  const offlineGroups = useMemo(
    () => data.consumerGroups.filter((g) => g.status === 'offline').length,
    [data.consumerGroups],
  )
  const onlineBrokerCount = data.brokers.filter((b) => b.status === 'online').length
  const totalBrokerCount = data.brokers.length || cluster?.totalBrokers || 0

  const activeTopics = useMemo<TopicItem[]>(
    () =>
      [...data.topics]
        .sort((a, b) => (b.tpsIn ?? 0) - (a.tpsIn ?? 0) || a.topic.localeCompare(b.topic))
        .slice(0, 6),
    [data.topics],
  )
  const maxTopicTps = activeTopics[0]?.tpsIn ?? 0

  const lagAlerts = useMemo<ConsumerGroupItem[]>(
    () =>
      lagThreshold <= 0
        ? []
        : [...data.consumerGroups]
            .filter((g) => Number(g.lag ?? 0) > lagThreshold)
            .sort((a, b) => Number(b.lag ?? 0) - Number(a.lag ?? 0))
            .slice(0, 6),
    [data.consumerGroups, lagThreshold],
  )

  const issues = useMemo(
    () => buildIssues(data, lagThreshold, diskThreshold, t),
    [data, lagThreshold, diskThreshold, t],
  )
  const throughputHistory = useMemo(
    () => aggregateThroughputHistory(data.brokers),
    [data.brokers],
  )
  const currentTpsIn = data.brokers.reduce(
    (sum, broker) => sum + Math.max(0, broker.tpsIn ?? 0),
    0,
  )
  const currentTpsOut = data.brokers.reduce(
    (sum, broker) => sum + Math.max(0, broker.tpsOut ?? 0),
    0,
  )

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
        // The fetch timestamp, not the wall clock: a ticking clock here read as
        // "this data is live", and it also re-rendered the page every second.
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
          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            <Unlink size={13} />
            {t('common.disconnect')}
          </Button>
        )}
      </PageHeader>

      <PageBody width="wide">
        {!isOnline ? (
          <OfflineEmpty
            message={t('overview.current.noConnection')}
            onAction={() => onNavigate?.('connections')}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {error && (
              <ErrorBanner className="m-0" message={t('overview.loadError', { message: error })} />
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-2.5">
              <StatCard
                icon={LayoutGrid}
                label={t('overview.stat.topics')}
                value={(data.topics.length || cluster?.totalTopics || 0).toLocaleString()}
                hint={t('overview.stat.topicSummary', { active: activeTopics.length })}
              />
              <StatCard
                icon={Users}
                label={t('overview.stat.consumers')}
                value={(data.consumerGroups.length || cluster?.totalGroups || 0).toLocaleString()}
                hint={t('overview.stat.consumersSummary', {
                  online: onlineGroups,
                  offline: offlineGroups,
                  unknown: Math.max(0, data.consumerGroups.length - onlineGroups - offlineGroups),
                })}
              />
              <StatCard
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
              <StatCard
                icon={Inbox}
                label={t('overview.stat.lag')}
                value={formatCompactCount(totalLag)}
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
                  <div className="text-fs-12 font-medium">{t('overview.issues.title')}</div>
                  <span className="text-muted-foreground text-fs-11">
                    {t('overview.issues.count', { count: issues.length })}
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/90 bg-card shadow-sm">
                  {issues.map((issue) => (
                    <div key={issue.key} className="flex items-start gap-2.5 border-t border-border px-3 py-2.5 first:border-t-0">
                      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", issue.severity === "high" && "bg-destructive", issue.severity === "med" && "bg-warning", issue.severity === "low" && "bg-muted-foreground")} />
                      <div className="min-w-0">
                        <div className="text-fs-125 font-medium leading-snug">{issue.title}</div>
                        <div className="mt-0.5 text-fs-115 leading-snug text-muted-foreground">{issue.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quick actions */}
            <div className="grid grid-cols-4 gap-2.5">
              <QuickAction
                icon={Send}
                label={t('overview.shortcut.send')}
                onClick={() => onNavigate?.('producer')}
              />
              <QuickAction
                icon={Search}
                label={t('overview.shortcut.search')}
                onClick={() => onNavigate?.('messages')}
              />
              <QuickAction
                icon={Plus}
                label={t('overview.shortcut.create')}
                onClick={() => onNavigate?.('topics')}
              />
              <QuickAction
                icon={RotateCcw}
                label={t('overview.shortcut.reset')}
                onClick={() => onNavigate?.('consumers')}
              />
            </div>

            {/* Throughput */}
            <ThroughputCard
              timestamps={throughputHistory.timestamps}
              prod={throughputHistory.inbound}
              cons={throughputHistory.outbound}
              currentIn={currentTpsIn}
              currentOut={currentTpsOut}
              loading={loading}
              refreshing={isRefreshing}
            />

            {/* Two lists */}
            <div className="grid grid-cols-2 gap-3">
              <ListCard
                title={t('overview.active.title')}
                subtitle={t('overview.active.subtitle')}
                empty={
                  data.topics.length === 0
                    ? t('overview.active.empty')
                    : t('overview.active.noTraffic')
                }
                onViewAll={() => onNavigate?.('topics')}
              >
                {/* Only render rows when at least one topic has inbound traffic;
                    otherwise fall back to the ListCard empty state instead of a
                    list of bare "—" placeholders. */}
                {maxTopicTps > 0
                  ? activeTopics.map((topic) => {
                      const tps = topic.tpsIn ?? 0
                      const pct = Math.max(4, Math.round((tps / maxTopicTps) * 100))
                      return (
                        <div key={topic.topic} className="flex items-center gap-2.5 px-3 py-2">
                          <span className="font-mono-design min-w-0 flex-1 truncate text-fs-12">
                            {topic.topic}
                          </span>
                          <div
                            className="h-1.5 shrink-0 overflow-hidden rounded-full bg-muted"
                            style={{ width: '4.31rem' }}
                          >
                            {tps > 0 && (
                              <div
                                className="h-full rounded-full bg-success"
                                style={{ width: `${pct}%` }}
                              />
                            )}
                          </div>
                          <span className="font-mono-design tabular-nums text-muted-foreground w-14 text-right text-fs-115">
                            {tps > 0 ? `${formatRate(tps)}/s` : '—'}
                          </span>
                        </div>
                      )
                    })
                  : null}
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
                        className={danger ? 'text-destructive' : 'text-warning'}
                      />
                      <span className="font-mono-design min-w-0 flex-1 truncate text-fs-12">
                        {g.group}
                      </span>
                      <Badge variant={danger ? 'destructive' : 'warning'}>
                        +{lag.toLocaleString()}
                      </Badge>
                    </div>
                  )
                })}
              </ListCard>
            </div>

            {/* Brokers compact */}
            {data.brokers.length > 0 && (
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <div className="text-fs-12 font-medium">{t('overview.broker.title')}</div>
                  <button
                    type="button"
                    className="text-muted-foreground text-fs-115 hover:text-foreground"
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
                      const warning = b.status === 'warning'
                      const label = `${b.brokerName}${b.brokerId !== 0 ? `-${b.brokerId}` : ''}`
                      const upperRole = String(b.role ?? '').toUpperCase()
                      const roleLabel = upperRole.startsWith('M')
                        ? 'master'
                        : upperRole.startsWith('S')
                          ? 'slave'
                          : b.brokerId === 0
                            ? 'master'
                            : 'slave'
                      return (
                        <span
                          key={`${b.brokerName}-${b.brokerId}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-fs-115 transition-colors hover:bg-muted"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background: online
                                ? 'hsl(var(--success))'
                                : warning
                                  ? 'hsl(var(--warning))'
                                  : 'hsl(var(--destructive))',
                            }}
                          />
                          <span className="font-mono-design">{label}</span>
                          <span className="text-muted-foreground text-fs-105">{roleLabel}</span>
                        </span>
                      )
                    })}
                </div>
              </Card>
            )}
          </div>
        )}
      </PageBody>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof LayoutGrid
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[2.62rem] items-center justify-center gap-1.5 rounded-[10px] border border-border/80 bg-card text-fs-12 font-medium shadow-card transition-[background-color,transform] hover:bg-accent active:scale-[0.98]"
    >
      <Icon size={13} className="text-muted-foreground" />
      {label}
    </button>
  )
}

function ThroughputCard({
  timestamps,
  prod,
  cons,
  currentIn,
  currentOut,
  loading,
  refreshing,
}: {
  timestamps: number[]
  prod: number[]
  cons: number[]
  currentIn: number
  currentOut: number
  loading: boolean
  refreshing?: boolean
}) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<{ index: number } | null>(null)
  const hasData = timestamps.length > 0 && (prod.length > 0 || cons.length > 0)
  const peak = Math.max(...prod, ...cons, 1)
  const window = throughputWindow()
  const xForTimestamp = (timestamp: number) =>
    ((timestamp - window.start) / Math.max(window.end - window.start, 1)) * 800
  const x = (index: number) => xForTimestamp(timestamps[index] ?? window.end)
  const y = (v: number) => 120 - (v / peak) * 100 - 8
  const ranges = continuousHistoryRanges(timestamps)
  const lineFor = (series: number[], start: number, end: number) =>
    series
      .slice(start, end + 1)
      .map((value, offset) => `${x(start + offset)},${y(value)}`)
      .join(' ')
  const polyFor = (series: number[], start: number, end: number) =>
    `${x(start)},120 ${lineFor(series, start, end)} ${x(end)},120`

  const hoverIndex = hover && hover.index < timestamps.length ? hover.index : null
  const hoverProd = hoverIndex != null ? (prod[hoverIndex] ?? 0) : currentIn
  const hoverCons = hoverIndex != null ? (cons[hoverIndex] ?? 0) : currentOut
  const hoverAgo =
    hoverIndex == null
      ? 0
      : Math.max(0, Math.round((Date.now() - (timestamps[hoverIndex] ?? Date.now())) / 60_000))
  const guideX = hoverIndex != null ? x(hoverIndex) : null
  const guideRatio = guideX == null ? 0 : Math.min(1, Math.max(0, guideX / 800))

  const onChartMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || timestamps.length === 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const targetTimestamp = window.start + ratio * (window.end - window.start)
    let nearestIndex = 0
    for (let index = 1; index < timestamps.length; index++) {
      if (
        Math.abs((timestamps[index] ?? window.end) - targetTimestamp) <
        Math.abs((timestamps[nearestIndex] ?? window.end) - targetTimestamp)
      ) {
        nearestIndex = index
      }
    }
    setHover({ index: nearestIndex })
  }

  return (
    <Card className="relative overflow-hidden p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-fs-12 font-medium">{t('overview.throughput.title')}</div>
          <div className="text-muted-foreground mt-0.5 text-fs-11">{t('overview.throughput.subtitle')}</div>
        </div>
        <div className="flex items-center gap-3">
          <Legend
            color="hsl(var(--success))"
            label={t('overview.throughput.produce')}
            value={hoverProd}
          />
          <Legend
            color="hsl(var(--info))"
            label={t('overview.throughput.consume')}
            value={hoverCons}
          />
        </div>
      </div>
      {hasData ? (
        <div
          className="relative h-[8.46rem] w-full cursor-crosshair"
          onMouseMove={onChartMove}
          onMouseLeave={() => setHover(null)}
        >
          <svg
            viewBox="0 0 800 120"
            preserveAspectRatio="none"
            className="pointer-events-none h-full w-full"
          >
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
            {prod.length > 0 &&
              ranges.map((range) => (
                <g key={`prod-${range.start}`}>
                  {range.end > range.start && (
                    <polygon
                      points={polyFor(prod, range.start, range.end)}
                      fill="hsl(var(--success))"
                      opacity={0.07}
                    />
                  )}
                  <polyline
                    points={lineFor(prod, range.start, range.end)}
                    fill="none"
                    stroke="hsl(var(--success))"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                  {range.start === range.end && (
                    <circle
                      cx={x(range.start)}
                      cy={y(prod[range.start] ?? 0)}
                      r={2.5}
                      fill="hsl(var(--success))"
                    />
                  )}
                </g>
              ))}
            {prod.length > 0 && (
              <circle
                cx={x(prod.length - 1)}
                cy={y(prod[prod.length - 1] ?? 0)}
                r={3}
                fill="hsl(var(--success))"
              />
            )}
            {cons.length > 0 &&
              ranges.map((range) => (
                <g key={`cons-${range.start}`}>
                  <polyline
                    points={lineFor(cons, range.start, range.end)}
                    fill="none"
                    stroke="hsl(var(--info))"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                  {range.start === range.end && (
                    <circle
                      cx={x(range.start)}
                      cy={y(cons[range.start] ?? 0)}
                      r={2.5}
                      fill="hsl(var(--info))"
                    />
                  )}
                </g>
              ))}
            {guideX != null && (
              <>
                <line
                  x1={guideX}
                  y1={0}
                  x2={guideX}
                  y2={120}
                  stroke="hsl(var(--foreground))"
                  strokeOpacity={0.22}
                  strokeWidth={1}
                />
                {prod.length > 0 && hoverIndex != null && (
                  <circle
                    cx={guideX}
                    cy={y(prod[hoverIndex] ?? 0)}
                    r={3.5}
                    fill="hsl(var(--success))"
                    stroke="hsl(var(--card))"
                    strokeWidth={1.5}
                  />
                )}
                {cons.length > 0 && hoverIndex != null && (
                  <circle
                    cx={guideX}
                    cy={y(cons[hoverIndex] ?? 0)}
                    r={3.5}
                    fill="hsl(var(--info))"
                    stroke="hsl(var(--card))"
                    strokeWidth={1.5}
                  />
                )}
              </>
            )}
          </svg>
          {hoverIndex != null && (
            <div
              className="bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 min-w-[9.08rem] rounded-md border px-2.5 py-1.5 shadow-sm"
              style={{
                left: `clamp(0px, calc(${guideRatio * 100}% - 60px), calc(100% - 124px))`,
              }}
            >
              <div className="text-muted-foreground mb-1 text-fs-105">
                {hoverAgo <= 0
                  ? t('overview.throughput.hoverNow')
                  : t('overview.throughput.hoverAgo', { n: hoverAgo })}
              </div>
              <div className="flex items-center justify-between gap-3 text-fs-11">
                <span className="text-muted-foreground">{t('overview.throughput.produce')}</span>
                <span className="font-mono-design tabular-nums">{formatRate(hoverProd)}/s</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-3 text-fs-11">
                <span className="text-muted-foreground">{t('overview.throughput.consume')}</span>
                <span className="font-mono-design tabular-nums">{formatRate(hoverCons)}/s</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground flex h-[8.46rem] items-center justify-center text-fs-12">
          {loading ? t('common.loading') : t('overview.throughput.noData')}
        </div>
      )}
      {refreshing && hasData && <div className="rl-shimmer-overlay" />}
    </Card>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: color }} />
      <span className="text-muted-foreground text-fs-11">{label}</span>
      <span className="font-mono-design tabular-nums text-fs-115">{formatRate(value)}/s</span>
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
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-fs-12 font-medium">{title}</span>
            {badge && <Badge variant="destructive">{badge}</Badge>}
          </div>
          <div className="text-muted-foreground mt-0.5 text-fs-11">{subtitle}</div>
        </div>
        {onViewAll && (
          <button
            type="button"
            className="text-muted-foreground shrink-0 text-fs-115 hover:text-foreground"
            onClick={onViewAll}
          >
            {t('common.viewAll')}
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {hasItems ? children : <div className="text-muted-foreground px-3 py-3 text-fs-12">{empty}</div>}
      </div>
    </Card>
  )
}
