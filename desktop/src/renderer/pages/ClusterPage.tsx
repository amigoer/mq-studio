import { useCallback, useMemo, useState } from 'react'
import { CircleDot, Activity, HardDrive, LayoutGrid, Server } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import type { BrokerNode } from '@generated/models'
import { PageHeader } from '@/components/PageHeader'
import { useCluster } from '@/hooks/useCluster'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { SlidingTabs } from '@/components/SlidingTabs'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'
import type { NavId } from '@/layout/Sidebar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

const HISTORY_LEN = 60

function aggregateHistory(
  brokers: BrokerNode[],
  field: 'tpsInHistory' | 'tpsOutHistory',
): number[] {
  const histories = brokers
    .map((b) => (b[field] ?? []) as number[])
    .filter((h) => Array.isArray(h) && h.length > 0)
  if (histories.length === 0) return []
  const len = Math.min(HISTORY_LEN, Math.max(...histories.map((h) => h.length)))
  const out = new Array<number>(len).fill(0)
  for (const h of histories) {
    const offset = Math.max(0, h.length - len)
    for (let i = 0; i < len; i++) {
      out[i] = (out[i] ?? 0) + (h[offset + i] ?? 0)
    }
  }
  return out
}

function formatTps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return Math.round(n).toLocaleString()
}

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

  const tpsInSeries = useMemo(() => aggregateHistory(brokers, 'tpsInHistory'), [brokers])
  const tpsOutSeries = useMemo(() => aggregateHistory(brokers, 'tpsOutHistory'), [brokers])
  const peak = Math.max(...tpsInSeries, ...tpsOutSeries, 1)
  const len = Math.max(tpsInSeries.length, tpsOutSeries.length, 1)
  const x = (i: number) => (i / Math.max(len - 1, 1)) * 800
  const y = (v: number) => 200 - (v / peak) * 180 - 10
  const lineFor = (series: number[]) => series.map((v, i) => `${x(i)},${y(v)}`).join(' ')

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
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          <SlidingTabs
            value={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'overview', label: t('cluster.tabs.overview') },
              { key: 'broker', label: t('cluster.tabs.broker') },
              { key: 'nameserver', label: t('cluster.tabs.nameserver') },
            ]}
          />
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-5">
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
                <span className="text-[12px]">{t('common.loading')}</span>
              </div>
            ) : activeTab === 'overview' ? (
              <>
                {/* Top stats */}
                <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-[12px]">{t('cluster.stat.health')}</span>
                      <CircleDot size={13} style={{ color: healthColor }} />
                    </div>
                    <div
                      className="mt-1 text-[20px] font-semibold tracking-tight tabular-nums leading-tight"
                      style={{ fontSize: 22, color: healthColor, marginTop: 6 }}
                    >
                      {healthLabel}
                    </div>
                    <div className="text-muted-foreground mt-1 text-[12px]">
                      {t('cluster.stat.healthSummary', {
                        online: onlineCount,
                        total: totalCount || onlineCount,
                      })}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-[12px]">{t('cluster.stat.tps')}</span>
                      <Activity size={13} className="text-muted-foreground" />
                    </div>
                    <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight tabular-nums" style={{ fontSize: 22, marginTop: 6 }}>
                      {formatTps(totalTps)}
                    </div>
                    <div className="text-muted-foreground mt-1 text-[12px]">{t('cluster.stat.tpsSubtitle')}</div>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-[12px]">{t('cluster.stat.disk')}</span>
                      <HardDrive size={13} className="text-muted-foreground" />
                    </div>
                    <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight tabular-nums" style={{ fontSize: 22, marginTop: 6 }}>
                      {Math.round(avgDisk)}%
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted mt-2">
                      <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.round(avgDisk)}%` }} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-[12px]">{t('cluster.stat.topics')}</span>
                      <LayoutGrid size={13} className="text-muted-foreground" />
                    </div>
                    <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight tabular-nums" style={{ fontSize: 22, marginTop: 6 }}>
                      {totalTopics.toLocaleString()}
                    </div>
                    <div className="text-muted-foreground mt-1 text-[12px]">
                      {t('cluster.stat.topicsSubtitle', { groups: totalGroups })}
                    </div>
                  </div>
                </div>

                {/* Throughput chart */}
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 24 }}>
                  {t('cluster.throughput')}
                </div>
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
                      <span className="text-[12px]">{t('overview.throughput.produce')}</span>
                      <span className="font-mono-design tabular-nums text-[12px]">
                        {formatTps(totalTpsIn)}/s
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
                      <span className="text-[12px]">{t('overview.throughput.consume')}</span>
                      <span className="font-mono-design tabular-nums text-[12px]">
                        {formatTps(totalTpsOut)}/s
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
                      {tpsInSeries.length > 0 && (
                        <polyline
                          points={lineFor(tpsInSeries)}
                          fill="none"
                          stroke="hsl(var(--success))"
                          strokeWidth={1.5}
                        />
                      )}
                      {tpsOutSeries.length > 0 && (
                        <polyline
                          points={lineFor(tpsOutSeries)}
                          fill="none"
                          stroke="hsl(var(--info))"
                          strokeWidth={1.5}
                        />
                      )}
                    </svg>
                  ) : (
                    <div
                      className="text-muted-foreground flex items-center justify-center text-[12px]"
                      style={{ height: 200 }}
                    >
                      {t('overview.throughput.noData')}
                    </div>
                  )}
                </Card>

                {/* Brokers */}
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 24 }}>
                  {t('cluster.brokerList')}
                </div>
                <BrokerTable brokers={sortedBrokers} />
              </>
            ) : activeTab === 'broker' ? (
              <BrokerTable brokers={sortedBrokers} />
            ) : (
              <NameServerList servers={cluster?.nameServers ?? []} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function BrokerTable({ brokers }: { brokers: BrokerNode[] }) {
  const { t } = useTranslation()
  if (brokers.length === 0) {
    return (
      <Card className="text-muted-foreground text-[12px]" style={{ padding: 24, textAlign: 'center' }}>
        {t('cluster.brokerEmpty')}
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
            <TableHead style={{ width: 200 }}>{t('cluster.brokerTable.disk')}</TableHead>
            <TableHead style={{ width: 100 }}>{t('cluster.brokerTable.status')}</TableHead>
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
                  <span className="font-mono-design text-muted-foreground text-[12px]">{b.address || '—'}</span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-[12px]">{b.version || '—'}</span>
                </TableCell>
                <TableCell className="font-mono-design text-[12px]" style={{ textAlign: 'right' }}>
                  {isOnline ? `${formatTps(b.tpsIn)} / ${formatTps(b.tpsOut)}` : '—'}
                </TableCell>
                <TableCell>
                  {isOnline ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted flex-1" style={{ maxWidth: 120 }}>
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${disk}%` }} />
                      </div>
                      <span className="tabular-nums text-muted-foreground text-[12px]">{disk}%</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-[12px]">—</span>
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
      <Card className="text-muted-foreground text-[12px]" style={{ padding: 24, textAlign: 'center' }}>
        {t('cluster.nameserverEmpty')}
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
          <span className="font-mono-design flex-1 text-[12px]">{s}</span>
          <Badge variant="success">{t('common.online')}</Badge>
        </div>
      ))}
    </Card>
  )
}
