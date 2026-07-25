import { useCallback, useMemo, useState } from 'react'
import { CircleDot, Activity, HardDrive, LayoutGrid, Server } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import type { BrokerNode } from '@generated/models'
import { PageHeader } from '@/components/PageHeader'
import { PageBody, PageToolbar } from '@/components/PageLayout'
import { StatCard } from '@/components/StatCard'
import { SectionLabel } from '@/components/SectionLabel'
import { formatRate } from '@/lib/format'
import { useCluster } from '@/hooks/useCluster'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { SlidingTabs } from '@/components/SlidingTabs'
import { EmptyState } from '@/components/EmptyState'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'
import type { NavId } from '@/layout/Sidebar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  aggregateThroughputHistory,
  continuousHistoryRanges,
  throughputWindow,
} from '@/lib/throughputHistory'

export function ClusterPage({ onNavigate }: { onNavigate?: (id: NavId) => void }) {
  const { t } = useTranslation()
  const { data, loading, error, refresh, hasOnline } = useCluster()
  const [activeTab, setActiveTab] = useState<'overview' | 'broker' | 'nameserver'>('overview')

  const cluster = data.cluster
  const brokers = data.brokers

  const onlineCount = brokers.filter((b) => b.status === 'online').length
  const offlineCount = brokers.filter((b) => b.status === 'offline').length
  const totalCount = brokers.length || cluster?.totalBrokers || 0
  const healthLabel = useMemo(() => {
    if (totalCount === 0) return t('cluster.stat.healthOffline')
    if (onlineCount === totalCount) return t('cluster.stat.healthHealthy')
    if (offlineCount === totalCount) return t('cluster.stat.healthOffline')
    return t('cluster.stat.healthDegraded')
  }, [offlineCount, onlineCount, totalCount, t])
  const healthColor =
    totalCount === 0 || offlineCount === totalCount
      ? 'hsl(var(--destructive))'
      : onlineCount === totalCount
        ? 'hsl(var(--success))'
        : 'hsl(var(--warning))'

  const totalTpsIn = brokers.reduce(
    (s, b) => s + (b.status === 'online' && (b.tpsIn ?? -1) >= 0 ? b.tpsIn : 0),
    0,
  )
  const totalTpsOut = brokers.reduce(
    (s, b) => s + (b.status === 'online' && (b.tpsOut ?? -1) >= 0 ? b.tpsOut : 0),
    0,
  )
  const totalTps = totalTpsIn + totalTpsOut
  const avgDisk =
    cluster?.avgDiskUsage ??
    (brokers.length === 0
      ? 0
      : brokers.reduce((s, b) => s + (b.commitLogDiskUsage ?? 0), 0) / brokers.length)
  const totalTopics = cluster?.totalTopics ?? 0
  const totalGroups = cluster?.totalGroups ?? 0

  const throughputHistory = useMemo(() => aggregateThroughputHistory(brokers), [brokers])
  const tpsInSeries = throughputHistory.inbound
  const tpsOutSeries = throughputHistory.outbound
  const historyRanges = continuousHistoryRanges(throughputHistory.timestamps)
  const peak = Math.max(...tpsInSeries, ...tpsOutSeries, 1)
  const historyWindow = throughputWindow()
  const x = (index: number) =>
    (((throughputHistory.timestamps[index] ?? historyWindow.end) - historyWindow.start) /
      Math.max(historyWindow.end - historyWindow.start, 1)) *
    800
  const y = (v: number) => 200 - (v / peak) * 180 - 10
  const lineFor = (series: number[], start: number, end: number) =>
    series
      .slice(start, end + 1)
      .map((value, offset) => `${x(start + offset)},${y(value)}`)
      .join(' ')

  const sortedBrokers = useMemo(
    () =>
      [...brokers].sort(
        (a, b) =>
          a.cluster.localeCompare(b.cluster) ||
          a.brokerName.localeCompare(b.brokerName) ||
          a.brokerId - b.brokerId,
      ),
    [brokers],
  )

  const doRefresh = useCallback(() => refresh({ silent: true }), [refresh])
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  const subtitle = !hasOnline
    ? t('cluster.subtitleNoConn')
    : t('cluster.subtitle', {
        cluster: cluster?.clusterName || '—',
        nameservers: cluster?.nameServers.length ?? 0,
        brokers: totalCount,
      })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('cluster.title')} subtitle={subtitle}>
        <RefreshButton spinning={isRefreshing} disabled={!hasOnline} onClick={handleRefresh} />
      </PageHeader>

      {hasOnline && (
        <PageToolbar>
          <SlidingTabs
            value={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'overview', label: t('cluster.tabs.overview') },
              { key: 'broker', label: t('cluster.tabs.broker') },
              { key: 'nameserver', label: t('cluster.tabs.nameserver') },
            ]}
          />
        </PageToolbar>
      )}

      <PageBody>
        {!hasOnline ? (
          <OfflineEmpty
            message={t('cluster.subtitleNoConn')}
            onAction={() => onNavigate?.('connections')}
          />
        ) : (
          <>
            {error && (
              <ErrorBanner
                className="mb-4 ml-0 mr-0 mt-0"
                message={t('cluster.loadError', { message: error })}
              />
            )}

            {loading && brokers.length === 0 ? (
              <div
                className="text-muted-foreground flex items-center justify-center"
                style={{ padding: 60, gap: 8 }}
              >
                <Spinner size={14} />
                <span className="text-fs-12">{t('common.loading')}</span>
              </div>
            ) : activeTab === 'overview' ? (
              <>
                {/* Top stats */}
                <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <StatCard
                    label={t('cluster.stat.health')}
                    icon={CircleDot}
                    iconColor={healthColor}
                    value={healthLabel}
                    valueColor={healthColor}
                    hint={t('cluster.stat.healthSummary', { online: onlineCount, total: totalCount || onlineCount, })}
                  />
                  <StatCard label={t('cluster.stat.tps')} icon={Activity} value={formatRate(totalTps)}
                    hint={t('cluster.stat.tpsSubtitle')}
                  />
                  <StatCard
                    label={t('cluster.stat.disk')}
                    icon={HardDrive}
                    value={`${Math.round(avgDisk)}%`}
                  >
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground transition-[width] duration-500"
                        style={{ width: `${Math.round(avgDisk)}%` }}
                      />
                    </div>
                  </StatCard>
                  <StatCard
                    label={t('cluster.stat.topics')}
                    icon={LayoutGrid}
                    value={totalTopics.toLocaleString()}
                    hint={t('cluster.stat.topicsSubtitle', { groups: totalGroups })}
                  />
                </div>

                {/* Throughput chart */}
                <SectionLabel>{t('cluster.throughput')}</SectionLabel>
                <Card style={{ padding: 16 }}>
                  <div className="mb-3 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: 'hsl(var(--success))',
                        }}
                      />
                      <span className="text-fs-12">{t('overview.throughput.produce')}</span>
                      <span className="font-mono-design tabular-nums text-fs-12">
                        {formatRate(totalTpsIn)}/s
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: 'hsl(var(--info))',
                        }}
                      />
                      <span className="text-fs-12">{t('overview.throughput.consume')}</span>
                      <span className="font-mono-design tabular-nums text-fs-12">
                        {formatRate(totalTpsOut)}/s
                      </span>
                    </div>
                  </div>
                  {tpsInSeries.length > 0 || tpsOutSeries.length > 0 ? (
                    <svg
                      viewBox="0 0 800 200"
                      preserveAspectRatio="none"
                      style={{ width: '100%', height: 200 }}
                    >
                      {[40, 80, 120, 160].map((yy) => (
                        <line
                          key={yy}
                          x1={0}
                          y1={yy}
                          x2={800}
                          y2={yy}
                          stroke="hsl(var(--border))"
                          strokeDasharray="3 3"
                        />
                      ))}
                      {tpsInSeries.length > 0 &&
                        historyRanges.map((range) => (
                          <g key={`in-${range.start}`}>
                            <polyline
                              points={lineFor(tpsInSeries, range.start, range.end)}
                              fill="none"
                              stroke="hsl(var(--success))"
                              strokeWidth={1.5}
                            />
                            {range.start === range.end && (
                              <circle
                                cx={x(range.start)}
                                cy={y(tpsInSeries[range.start] ?? 0)}
                                r={2.5}
                                fill="hsl(var(--success))"
                              />
                            )}
                          </g>
                        ))}
                      {tpsOutSeries.length > 0 &&
                        historyRanges.map((range) => (
                          <g key={`out-${range.start}`}>
                            <polyline
                              points={lineFor(tpsOutSeries, range.start, range.end)}
                              fill="none"
                              stroke="hsl(var(--info))"
                              strokeWidth={1.5}
                            />
                            {range.start === range.end && (
                              <circle
                                cx={x(range.start)}
                                cy={y(tpsOutSeries[range.start] ?? 0)}
                                r={2.5}
                                fill="hsl(var(--info))"
                              />
                            )}
                          </g>
                        ))}
                    </svg>
                  ) : (
                    <div
                      className="text-muted-foreground flex items-center justify-center text-fs-12"
                      style={{ height: 200 }}
                    >
                      {t('overview.throughput.noData')}
                    </div>
                  )}
                </Card>
              </>
            ) : activeTab === 'broker' ? (
              <BrokerTable brokers={sortedBrokers} />
            ) : (
              <NameServerList servers={cluster?.nameServers ?? []} />
            )}
          </>
        )}
      </PageBody>
    </div>
  )
}

function BrokerTable({ brokers }: { brokers: BrokerNode[] }) {
  const { t } = useTranslation()
  if (brokers.length === 0) {
    return (
      <Card>
        <EmptyState compact title={t('cluster.brokerEmpty')} />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('cluster.brokerTable.name')}</TableHead>
            <TableHead>{t('cluster.brokerTable.role')}</TableHead>
            <TableHead>{t('cluster.brokerTable.address')}</TableHead>
            <TableHead>{t('cluster.brokerTable.version')}</TableHead>
            <TableHead style={{ textAlign: 'right' }}>{t('cluster.brokerTable.tps')}</TableHead>
            <TableHead style={{ width: '15.38rem' }}>{t('cluster.brokerTable.disk')}</TableHead>
            <TableHead style={{ width: '7.69rem' }}>{t('cluster.brokerTable.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brokers.map((b) => {
            const isOnline = b.status === 'online'
            const isWarning = b.status === 'warning'
            const role = String(b.role || '').toUpperCase()
            const isMaster = role === 'MASTER'
            const disk = Math.round(b.commitLogDiskUsage ?? 0)
            return (
              <TableRow key={`${b.brokerName}-${b.brokerId}`}>
                <TableCell>
                  <div className="font-mono-design">
                    {b.brokerName}
                    {b.brokerId !== 0 ? `-${b.brokerId}` : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={isMaster ? 'info' : 'outline'}>{role || '—'}</Badge>
                </TableCell>
                <TableCell>
                  <span className="font-mono-design text-muted-foreground text-fs-12">{b.address || '—'}</span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-fs-12">{b.version || '—'}</span>
                </TableCell>
                <TableCell className="font-mono-design text-fs-12" style={{ textAlign: 'right' }}>
                  {isOnline ? `${formatRate(b.tpsIn)} / ${formatRate(b.tpsOut)}` : '—'}
                </TableCell>
                <TableCell>
                  {isOnline ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted flex-1" style={{ maxWidth: '9.23rem' }}>
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${disk}%` }} />
                      </div>
                      <span className="tabular-nums text-muted-foreground text-fs-12">{disk}%</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-fs-12">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={isOnline ? 'success' : isWarning ? 'warning' : 'outline'}>
                    {isOnline
                      ? t('common.online')
                      : isWarning
                        ? t('common.warning')
                        : t('common.offline')}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

function NameServerList({ servers }: { servers: string[] }) {
  const { t } = useTranslation()
  if (servers.length === 0) {
    return (
      <Card>
        <EmptyState compact title={t('cluster.nameserverEmpty')} />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      {servers.map((s, i) => (
        <div
          key={s}
          className="flex items-center gap-3"
          style={{
            padding: '12px 16px',
            borderTop: i ? '1px solid hsl(var(--border))' : undefined,
          }}
        >
          <Server size={14} className="text-muted-foreground" />
          <span className="font-mono-design flex-1 text-fs-12">{s}</span>
          <Badge variant="success">{t('common.online')}</Badge>
        </div>
      ))}
    </Card>
  )
}
