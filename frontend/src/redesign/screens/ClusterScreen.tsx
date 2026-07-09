import { useCallback, useMemo, useState } from 'react'
import { CircleDot, Activity, HardDrive, LayoutGrid, Server } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import type { BrokerNode } from '../../../bindings/rocket-leaf/internal/model/models.js'
import { PageHeader } from '../shell'
import { useCluster } from '@/hooks/useCluster'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { SlidingTabs } from '@/components/SlidingTabs'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'

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

export function ClusterScreen() {
  const { t } = useTranslation()
  const { data, loading, error, refresh, hasOnline } = useCluster()
  const [activeTab, setActiveTab] = useState<'overview' | 'broker' | 'nameserver'>('overview')

  const cluster = data.cluster
  const brokers = data.brokers

  const onlineCount = brokers.filter((b) => b.status === 'online').length
  const totalCount = brokers.length || cluster?.totalBrokers || 0
  const healthLabel = useMemo(() => {
    if (totalCount === 0) return t('cluster.stat.healthOffline')
    if (onlineCount === totalCount) return t('cluster.stat.healthHealthy')
    if (onlineCount === 0) return t('cluster.stat.healthOffline')
    return t('cluster.stat.healthDegraded')
  }, [onlineCount, totalCount, t])
  const healthColor =
    onlineCount === 0
      ? 'hsl(var(--destructive))'
      : onlineCount === totalCount
        ? 'hsl(var(--success))'
        : 'hsl(var(--warning))'

  const totalTpsIn = brokers.reduce((s, b) => s + (b.tpsIn ?? 0), 0)
  const totalTpsOut = brokers.reduce((s, b) => s + (b.tpsOut ?? 0), 0)
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
          <OfflineEmpty message={t('cluster.subtitleNoConn')} />
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
                className="rl-muted flex items-center justify-center"
                style={{ padding: 60, gap: 8 }}
              >
                <Spinner size={14} />
                <span className="text-[12px]">{t('common.loading')}</span>
              </div>
            ) : activeTab === 'overview' ? (
              <>
                {/* Top stats */}
                <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div className="rl-stat" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="rl-muted text-[12px]">{t('cluster.stat.health')}</span>
                      <CircleDot size={13} style={{ color: healthColor }} />
                    </div>
                    <div
                      className="value"
                      style={{ fontSize: 22, color: healthColor, marginTop: 6 }}
                    >
                      {healthLabel}
                    </div>
                    <div className="rl-muted mt-1 text-[12px]">
                      {t('cluster.stat.healthSummary', {
                        online: onlineCount,
                        total: totalCount || onlineCount,
                      })}
                    </div>
                  </div>
                  <div className="rl-stat" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="rl-muted text-[12px]">{t('cluster.stat.tps')}</span>
                      <Activity size={13} className="rl-muted" />
                    </div>
                    <div className="value rl-tabular" style={{ fontSize: 22, marginTop: 6 }}>
                      {formatTps(totalTps)}
                    </div>
                    <div className="rl-muted mt-1 text-[12px]">{t('cluster.stat.tpsSubtitle')}</div>
                  </div>
                  <div className="rl-stat" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="rl-muted text-[12px]">{t('cluster.stat.disk')}</span>
                      <HardDrive size={13} className="rl-muted" />
                    </div>
                    <div className="value rl-tabular" style={{ fontSize: 22, marginTop: 6 }}>
                      {Math.round(avgDisk)}%
                    </div>
                    <div className="rl-progress mt-2">
                      <div className="bar" style={{ width: `${Math.round(avgDisk)}%` }} />
                    </div>
                  </div>
                  <div className="rl-stat" style={{ padding: 14 }}>
                    <div className="flex items-center justify-between">
                      <span className="rl-muted text-[12px]">{t('cluster.stat.topics')}</span>
                      <LayoutGrid size={13} className="rl-muted" />
                    </div>
                    <div className="value rl-tabular" style={{ fontSize: 22, marginTop: 6 }}>
                      {totalTopics.toLocaleString()}
                    </div>
                    <div className="rl-muted mt-1 text-[12px]">
                      {t('cluster.stat.topicsSubtitle', { groups: totalGroups })}
                    </div>
                  </div>
                </div>

                {/* Throughput chart */}
                <div className="rl-section-label" style={{ marginTop: 24 }}>
                  {t('cluster.throughput')}
                </div>
                <div className="rl-card" style={{ padding: 16 }}>
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
                      <span className="font-mono-design rl-tabular text-[12px]">
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
                      <span className="font-mono-design rl-tabular text-[12px]">
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
                      className="rl-muted flex items-center justify-center text-[12px]"
                      style={{ height: 200 }}
                    >
                      {t('overview.throughput.noData')}
                    </div>
                  )}
                </div>

                {/* Brokers */}
                <div className="rl-section-label" style={{ marginTop: 24 }}>
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
      <div className="rl-card rl-muted text-[12px]" style={{ padding: 24, textAlign: 'center' }}>
        {t('cluster.brokerEmpty')}
      </div>
    )
  }
  return (
    <div className="rl-card overflow-hidden">
      <table className="rl-table">
        <thead>
          <tr>
            <th>{t('cluster.brokerTable.name')}</th>
            <th>{t('cluster.brokerTable.role')}</th>
            <th>{t('cluster.brokerTable.address')}</th>
            <th>{t('cluster.brokerTable.version')}</th>
            <th style={{ textAlign: 'right' }}>{t('cluster.brokerTable.tps')}</th>
            <th style={{ width: 200 }}>{t('cluster.brokerTable.disk')}</th>
            <th style={{ width: 100 }}>{t('cluster.brokerTable.status')}</th>
          </tr>
        </thead>
        <tbody>
          {brokers.map((b) => {
            const isOnline = b.status === 'online'
            const role = String(b.role || '').toUpperCase()
            const isMaster = role === 'MASTER'
            const disk = Math.round(b.commitLogDiskUsage ?? 0)
            return (
              <tr key={`${b.brokerName}-${b.brokerId}`}>
                <td>
                  <div className="font-mono-design">
                    {b.brokerName}
                    {b.brokerId !== 0 ? `-${b.brokerId}` : ''}
                  </div>
                </td>
                <td>
                  <span className={'rl-badge ' + (isMaster ? 'rl-badge-info' : 'rl-badge-outline')}>
                    {role || '—'}
                  </span>
                </td>
                <td>
                  <span className="font-mono-design rl-muted text-[12px]">{b.address || '—'}</span>
                </td>
                <td>
                  <span className="rl-muted text-[12px]">{b.version || '—'}</span>
                </td>
                <td className="font-mono-design text-[12px]" style={{ textAlign: 'right' }}>
                  {isOnline ? `${formatTps(b.tpsIn)} / ${formatTps(b.tpsOut)}` : '—'}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="rl-progress flex-1" style={{ maxWidth: 120 }}>
                      <div className="bar" style={{ width: `${disk}%` }} />
                    </div>
                    <span className="rl-tabular rl-muted text-[12px]">{disk}%</span>
                  </div>
                </td>
                <td>
                  <span
                    className={'rl-badge ' + (isOnline ? 'rl-badge-success' : 'rl-badge-outline')}
                  >
                    {isOnline ? t('common.online') : t('common.offline')}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NameServerList({ servers }: { servers: string[] }) {
  const { t } = useTranslation()
  if (servers.length === 0) {
    return (
      <div className="rl-card rl-muted text-[12px]" style={{ padding: 24, textAlign: 'center' }}>
        {t('cluster.nameserverEmpty')}
      </div>
    )
  }
  return (
    <div className="rl-card overflow-hidden">
      {servers.map((s, i) => (
        <div
          key={s}
          className="flex items-center gap-3"
          style={{
            padding: '12px 16px',
            borderTop: i ? '1px solid hsl(var(--border))' : undefined,
          }}
        >
          <Server size={14} className="rl-muted" />
          <span className="font-mono-design flex-1 text-[12px]">{s}</span>
          <span className="rl-badge rl-badge-success">{t('common.online')}</span>
        </div>
      ))}
    </div>
  )
}
