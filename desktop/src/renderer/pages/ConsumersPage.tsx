import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Search,
  AlertCircle,
  Users,
  X,
  Tag,
  RotateCcw,
  Edit,
  Plus,
  Check,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConsumeMode, type ConsumerGroupItem, type GroupSubscription } from '@generated/models'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useConsumers } from '@/hooks/useConsumers'
import { useCluster } from '@/hooks/useCluster'
import { useDelayedUnmount } from '@/hooks/useDelayedUnmount'
import * as consumerApi from '@/api/consumer'
import { formatErrorMessage } from '@/lib/utils'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { SlidingTabs } from '@/components/SlidingTabs'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'
import type { NavId } from '@/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type StatusFilter = 'all' | 'online' | 'warning' | 'offline'

function formatTps(n: number): string {
  if (!n || !Number.isFinite(n)) return '0'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return Math.round(n).toLocaleString()
}

function formatMetric(n: number): string {
  return Number.isFinite(n) && n >= 0 ? n.toLocaleString() : '—'
}

function statusBadgeVariant(
  status: string,
): 'success' | 'warning' | 'destructive' | 'outline' {
  switch (status) {
    case 'online':
      return 'success'
    case 'warning':
      return 'warning'
    case 'offline':
      return 'destructive'
    default:
      return 'outline'
  }
}

export function ConsumersPage({ onNavigate }: { onNavigate?: (id: NavId) => void }) {
  const { t } = useTranslation()
  const { groups, loading, error, refresh, hasOnline } = useConsumers()
  const { data: clusterData } = useCluster()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState<
    { mode: 'create' } | { mode: 'edit'; group: ConsumerGroupItem } | null
  >(null)
  const [resetTarget, setResetTarget] = useState<ConsumerGroupItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ConsumerGroupItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const counts = useMemo(() => {
    const c = { all: groups.length, online: 0, warning: 0, offline: 0 }
    for (const g of groups) {
      if (g.status === 'online') c.online++
      else if (g.status === 'warning') c.warning++
      else if (g.status === 'offline') c.offline++
    }
    return c
  }, [groups])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return groups.filter((g) => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false
      if (q) {
        const inName = g.group.toLowerCase().includes(q)
        const inSubs = (g.subscriptions || []).some((s) => s.topic.toLowerCase().includes(q))
        if (!inName && !inSubs) return false
      }
      return true
    })
  }, [groups, search, statusFilter])

  const dismissPanel = useCallback(() => {
    setSelectedName(null)
  }, [])

  // Esc closes the detail panel
  useEffect(() => {
    if (!selectedName) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissPanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedName, dismissPanel])

  // Clicking the list pane outside any row also closes the panel
  const handleListBackgroundClick = (e: React.MouseEvent) => {
    if (!selectedName) return
    if ((e.target as HTMLElement).closest('tr')) return
    dismissPanel()
  }

  const selected = useMemo<ConsumerGroupItem | null>(
    () => groups.find((g) => g.group === selectedName) ?? null,
    [groups, selectedName],
  )
  const panelMount = useDelayedUnmount(!!(hasOnline && selected))
  // Keep the displayed item alive during the exit animation.
  const [pinnedSelected, setPinnedSelected] = useState<ConsumerGroupItem | null>(null)
  useEffect(() => {
    if (selected) setPinnedSelected(selected)
  }, [selected])
  const renderedSelected = selected ?? pinnedSelected

  const doRefresh = useCallback(() => refresh({ silent: true }), [refresh])
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  const handleDelete = async () => {
    if (!confirmDelete) return
    // Pick first master broker as the target for delete (RocketMQ requires it)
    const broker = clusterData.brokers.find(
      (b) => String(b.role).toUpperCase() === 'MASTER' && b.address,
    )
    if (!broker) {
      toast.error(t('consumers.edit.noBrokers'))
      return
    }
    setDeleting(true)
    try {
      await consumerApi.deleteConsumerGroup(confirmDelete.group, broker.address)
      toast.success(t('consumers.detail.deleteSuccess'))
      if (selectedName === confirmDelete.group) setSelectedName(null)
      setConfirmDelete(null)
      await refresh()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const subtitle = !hasOnline
    ? t('consumers.subtitleNoConn')
    : filtered.length === groups.length
      ? t('consumers.subtitle', { count: groups.length })
      : t('consumers.subtitleFiltered', { count: filtered.length, total: groups.length })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('consumers.title')} subtitle={subtitle}>
        <div className="relative" style={{ width: 240 }}>
          <span className="pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 text-muted-foreground">
            <Search size={14} />
          </span>
          <Input
            className="pl-8"
            placeholder={t('consumers.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <RefreshButton spinning={isRefreshing} disabled={!hasOnline} onClick={handleRefresh} />
        <Button variant="default" size="sm"
          onClick={() => setEditorOpen({ mode: 'create' })}
          disabled={!hasOnline}
        >
          <Plus size={13} />
          {t('common.create')}
        </Button>
      </PageHeader>

      {hasOnline && (
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          <SlidingTabs
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              {
                key: 'all',
                label: t('consumers.filterAll'),
                count: counts.all,
              },
              {
                key: 'online',
                label: t('consumers.filterOnline'),
                count: counts.online,
              },
              {
                key: 'warning',
                label: t('consumers.filterWarning'),
                count: counts.warning,
              },
              {
                key: 'offline',
                label: t('consumers.filterOffline'),
                count: counts.offline,
              },
            ]}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="scroll-thin min-w-0 flex-1 overflow-auto"
          onClick={handleListBackgroundClick}
        >
          {!hasOnline ? (
            <OfflineEmpty
              message={t('consumers.subtitleNoConn')}
              onAction={() => onNavigate?.('connections')}
            />
          ) : loading && groups.length === 0 ? (
            <div
              className="text-muted-foreground flex items-center justify-center"
              style={{ padding: 60, gap: 8 }}
            >
              <Spinner size={14} />
              <span className="text-[12px]">{t('common.loading')}</span>
            </div>
          ) : (
            <>
              {error && <ErrorBanner message={t('consumers.loadError', { message: error })} />}
              {filtered.length === 0 ? (
                <div className="text-muted-foreground text-center" style={{ padding: 40, fontSize: 12 }}>
                  {t('consumers.empty')}
                </div>
              ) : (
                <Table className="rl-table-consumers">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('consumers.table.name')}</TableHead>
                      <TableHead className="col-metric">{t('consumers.table.instances')}</TableHead>
                      <TableHead className="col-metric">{t('consumers.table.lag')}</TableHead>
                      <TableHead className="col-chevron" aria-hidden />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((g) => {
                      const subTopic =
                        g.subscriptions[0]?.topic ||
                        (g.topicCount > 0 ? `${g.topicCount} topics` : '—')
                      const selected = selectedName === g.group
                      const statusText =
                        g.status === 'online'
                          ? t('common.online')
                          : g.status === 'warning'
                            ? t('consumers.filterWarning')
                            : t('common.offline')
                      return (
                        <TableRow
                          key={g.group}
                          className={selected ? 'selected' : ''}
                          onClick={() => setSelectedName(g.group)}
                        >
                          <TableCell>
                            <div className="flex min-w-0 items-start gap-2.5">
                              <span
                                className={
                                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' +
                                  (g.status === 'online'
                                    ? 'bg-[hsl(var(--success))]'
                                    : g.status === 'warning'
                                      ? 'bg-[hsl(var(--warning))]'
                                      : g.status === 'offline'
                                        ? 'bg-[hsl(var(--destructive)/0.55)]'
                                        : 'bg-[hsl(var(--muted-foreground)/0.35)]')
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="font-mono-design truncate text-[12.5px] font-medium tracking-tight">
                                    {g.group}
                                  </span>
                                  <Badge variant={statusBadgeVariant(g.status)} className="shrink-0">
                                    {statusText}
                                  </Badge>
                                  {g.consumeMode && (
                                    <Badge variant="outline" className="shrink-0">
                                      {g.consumeMode}
                                    </Badge>
                                  )}
                                </div>
                                <div className="font-mono-design text-muted-foreground mt-0.5 truncate text-[11px]">
                                  {subTopic}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="col-metric tabular-nums">{g.onlineClients}</TableCell>
                          <TableCell
                            className={
                              'col-metric tabular-nums ' +
                              (g.lag > 1000 ? 'text-destructive' : 'text-muted-foreground')
                            }
                          >
                            {g.lag > 1000 && (
                              <AlertCircle size={11} className="mr-1 inline-block align-[-1px]" />
                            )}
                            {formatMetric(g.lag)}
                          </TableCell>
                          <TableCell className="col-chevron">
                            <ChevronRight
                              size={14}
                              className={
                                'text-muted-foreground transition-opacity ' +
                                (selected ? 'opacity-70' : 'opacity-35')
                              }
                              aria-hidden
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </div>

        {panelMount.shouldRender && renderedSelected && (
          <GroupDetailPanel
            group={renderedSelected}
            exiting={panelMount.exiting}
            onClose={dismissPanel}
            onReset={() => setResetTarget(renderedSelected)}
            onEdit={() => setEditorOpen({ mode: 'edit', group: renderedSelected })}
            onDelete={() => setConfirmDelete(renderedSelected)}
          />
        )}
      </div>

      {editorOpen && (
        <GroupEditor
          mode={editorOpen.mode}
          initial={editorOpen.mode === 'edit' ? editorOpen.group : null}
          brokers={clusterData.brokers}
          onClose={() => setEditorOpen(null)}
          onSaved={async () => {
            setEditorOpen(null)
            await refresh()
          }}
        />
      )}

      {resetTarget && (
        <ResetOffsetDialog
          group={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={async () => {
            setResetTarget(null)
            await refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={t('consumers.detail.actions.delete')}
        description={t('consumers.detail.deleteConfirm', { name: confirmDelete?.group ?? '' })}
        confirmText={deleting ? t('common.loading') : t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => !deleting && setConfirmDelete(null)}
      />
    </div>
  )
}

// ---------- Detail Panel ----------

function GroupDetailPanel({
  group,
  exiting,
  onClose,
  onReset,
  onEdit,
  onDelete,
}: {
  group: ConsumerGroupItem
  exiting: boolean
  onClose: () => void
  onReset: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'overview' | 'instances' | 'subscriptions' | 'config'>('overview')
  const tps = useMemo(
    () => (group.subscriptions || []).reduce((s, sub) => s + (sub.consumeTps || 0), 0),
    [group.subscriptions],
  )

  return (
    <aside
      className={'scroll-thin detail-panel' + (exiting ? ' exiting' : '')}
      style={{
        width: 420,
        borderLeft: '1px solid hsl(var(--border))',
        overflow: 'auto',
        background: 'hsl(var(--background))',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '16px 20px', borderBottom: '1px solid hsl(var(--border))' }}>
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Users size={15} className="text-muted-foreground" />
            <span className="font-mono-design truncate font-semibold">{group.group}</span>
            {group.lag > 1000 && <Badge variant="warning" className="shrink-0">{t('consumers.table.lag')}</Badge>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <Tag size={11} />
          <span>
            {group.topicCount} {t('topics.title')}
          </span>
          <span
            style={{ width: 3, height: 3, borderRadius: 999, background: 'hsl(var(--border))' }}
          />
          <span>{group.consumeMode || '—'}</span>
          <span
            style={{ width: 3, height: 3, borderRadius: 999, background: 'hsl(var(--border))' }}
          />
          <span>
            {group.onlineClients} {t('consumers.detail.instances')}
          </span>
        </div>
      </div>

      <div
        className="utabs"
        style={{
          paddingLeft: 20,
          paddingRight: 20,
          borderBottom: '1px solid hsl(var(--border))',
        }}
      >
        {(['overview', 'subscriptions', 'instances', 'config'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={'utab ' + (tab === k ? 'active' : '')}
            onClick={() => setTab(k)}
          >
            {t(`consumers.tabs.${k === 'subscriptions' ? 'subscriptions' : k}`)}
            {k === 'instances' && (
              <span className="text-muted-foreground" style={{ marginLeft: 4 }}>
                {group.onlineClients}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto" style={{ padding: '16px 20px' }}>
        {tab === 'overview' && (
          <>
            <div
              className="grid"
              style={{
                gridTemplateColumns: '1fr 1fr 1fr',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 14px' }}>
                <div className="text-muted-foreground text-[12px]">{t('consumers.stat.instances')}</div>
                <div className="tabular-nums mt-1 font-semibold" style={{ fontSize: 18 }}>
                  {group.onlineClients}
                </div>
              </div>
              <div style={{ padding: '12px 14px', borderLeft: '1px solid hsl(var(--border))' }}>
                <div className="flex items-center gap-1">
                  <div className="text-muted-foreground text-[12px]">{t('consumers.stat.lag')}</div>
                  {group.lag > 1000 && (
                    <AlertCircle size={10} style={{ color: 'hsl(var(--warning))' }} />
                  )}
                </div>
                <div
                  className="tabular-nums mt-1 font-semibold"
                  style={{
                    fontSize: 18,
                    color: group.lag > 1000 ? 'hsl(var(--warning))' : undefined,
                  }}
                >
                  {formatMetric(group.lag)}
                </div>
              </div>
              <div style={{ padding: '12px 14px', borderLeft: '1px solid hsl(var(--border))' }}>
                <div className="text-muted-foreground text-[12px]">{t('consumers.stat.tps')}</div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="tabular-nums font-semibold" style={{ fontSize: 18 }}>
                    {formatTps(tps)}
                  </span>
                  <span className="text-muted-foreground text-[12px]" style={{ marginBottom: 1 }}>
                    /s
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 20 }}>
              {t('consumers.detail.subscriptions')}
            </div>
            <SubscriptionList subs={group.subscriptions} />
          </>
        )}

        {tab === 'subscriptions' && (
          <>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 4 }}>
              {t('consumers.detail.subscriptions')}
            </div>
            <SubscriptionList subs={group.subscriptions} />
          </>
        )}

        {tab === 'instances' && (
          <>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 4 }}>
              {t('consumers.detail.instances')}
            </div>
            {group.clients.length === 0 ? (
              <div className="text-muted-foreground text-[12px]" style={{ padding: 16, textAlign: 'center' }}>
                {t('consumers.detail.instancesEmpty')}
              </div>
            ) : (
              <Card className="overflow-hidden">
                {group.clients.map((c, i) => (
                  <div
                    key={c.clientId}
                    style={{
                      padding: '10px 14px',
                      borderTop: i ? '1px solid hsl(var(--border))' : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono-design truncate text-[12px]">{c.clientId}</span>
                      {c.version && (
                        <Badge variant="outline"
                          style={{ height: 18, fontSize: 10 }}
                        >
                          {c.version}
                        </Badge>
                      )}
                    </div>
                    <div
                      className="text-muted-foreground mt-1 flex items-center gap-2 text-[11px]"
                      style={{ fontFamily: 'monospace' }}
                    >
                      <span>{c.ip}</span>
                      {c.lastHeartbeat && (
                        <>
                          <span>·</span>
                          <span>{c.lastHeartbeat}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}

        {tab === 'config' && (
          <>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 4 }}>
              {t('consumers.detail.config')}
            </div>
            <div>
              <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-[13px] last:border-b-0">
                <div className="text-muted-foreground">{t('consumers.detail.configMode')}</div>
                <div className="text-foreground">{group.consumeMode || '—'}</div>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-[13px] last:border-b-0">
                <div className="text-muted-foreground">{t('consumers.detail.configMaxRetry')}</div>
                <div className="text-foreground tabular-nums">{group.maxRetry}</div>
              </div>
              {group.cluster && (
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-[13px] last:border-b-0">
                  <div className="text-muted-foreground">{t('consumers.detail.configCluster')}</div>
                  <div className="text-foreground">{group.cluster}</div>
                </div>
              )}
              {group.lastUpdate && (
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-[13px] last:border-b-0">
                  <div className="text-muted-foreground">{t('consumers.detail.configLastUpdate')}</div>
                  <div className="text-foreground font-mono-design text-[12px]">{group.lastUpdate}</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div
        className="bg-background flex items-center gap-2"
        style={{ padding: '12px 20px', borderTop: '1px solid hsl(var(--border))' }}
      >
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw size={13} />
          {t('consumers.detail.actions.reset')}
        </Button>
        <Button variant="outline" size="sm"
          style={{ marginLeft: 'auto' }}
          onClick={onEdit}
        >
          <Edit size={13} />
          {t('consumers.detail.actions.edit')}
        </Button>
        <Button variant="ghost" size="icon-sm"
          style={{ color: 'hsl(var(--destructive))' }}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </aside>
  )
}

function SubscriptionList({ subs }: { subs: GroupSubscription[] }) {
  const { t } = useTranslation()
  if (subs.length === 0) {
    return (
      <div className="text-muted-foreground text-[12px]" style={{ padding: 16, textAlign: 'center' }}>
        {t('consumers.detail.subscriptionsEmpty')}
      </div>
    )
  }
  return (
    <Card className="overflow-hidden">
      {subs.map((s, i) => (
        <div
          key={s.topic}
          className="flex items-center gap-2"
          style={{
            padding: '10px 14px',
            borderTop: i ? '1px solid hsl(var(--border))' : undefined,
          }}
        >
          <Tag size={12} className="text-muted-foreground" />
          <span className="font-mono-design flex-1 truncate text-[13px]">{s.topic}</span>
          {s.expression && s.expression !== '*' && (
            <span
              className="font-mono-design text-muted-foreground text-[11px]"
              title="Tag filter"
              style={{ maxWidth: 120 }}
            >
              {s.expression}
            </span>
          )}
          {s.consumeTps > 0 && (
            <span className="font-mono-design tabular-nums text-muted-foreground text-[12px]">
              {formatTps(s.consumeTps)}/s
            </span>
          )}
        </div>
      ))}
    </Card>
  )
}

// ---------- Reset offset ----------

function ResetOffsetDialog({
  group,
  onClose,
  onDone,
}: {
  group: ConsumerGroupItem
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [topic, setTopic] = useState<string>(group.subscriptions[0]?.topic ?? '')
  const [mode, setMode] = useState<'now' | 'earliest' | 'custom'>('now')
  const [custom, setCustom] = useState<string>('')
  const [force, setForce] = useState(true)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async () => {
    if (!topic) {
      toast.error(t('consumers.reset.topicHint'))
      return
    }
    let timestamp = 0
    if (mode === 'now') timestamp = Date.now()
    else if (mode === 'custom') {
      const ms = Date.parse(custom)
      if (Number.isNaN(ms)) {
        toast.error(t('consumers.reset.timeCustom'))
        return
      }
      timestamp = ms
    }
    setBusy(true)
    try {
      await consumerApi.resetOffset(group.group, topic, timestamp, force)
      toast.success(t('consumers.reset.success'))
      await onDone()
    } catch (e) {
      toast.error(t('consumers.reset.error'), { description: formatErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-border/50 bg-background p-6 shadow-lg"
      >
        <h2 className="text-base font-semibold">{t('consumers.reset.title')}</h2>
        <div className="mt-4 grid gap-3.5">
          <div>
            <div className="text-muted-foreground mb-2 text-[12px]">{t('consumers.reset.topic')}</div>
            {group.subscriptions.length === 0 ? (
              <Input
                className="font-mono-design"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            ) : (
              <Select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                {group.subscriptions.map((s) => (
                  <option key={s.topic} value={s.topic}>
                    {s.topic}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <div className="text-muted-foreground mb-2 text-[12px]">{t('consumers.reset.time')}</div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px]" style={{ cursor: 'pointer' }}>
                <input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} />
                {t('consumers.reset.timeNow')}
              </label>
              <label className="flex items-center gap-2 text-[13px]" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={mode === 'earliest'}
                  onChange={() => setMode('earliest')}
                />
                {t('consumers.reset.timeEarliest')}
              </label>
              <label className="flex items-center gap-2 text-[13px]" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={mode === 'custom'}
                  onChange={() => setMode('custom')}
                />
                {t('consumers.reset.timeCustom')}
              </label>
              {mode === 'custom' && (
                <Input
                  className="font-mono-design"
                  type="datetime-local"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            {t('consumers.reset.force')}
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="outline" size="sm"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm"
            type="button"
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? <Spinner size={13} /> : <RotateCcw size={13} />}
            {t('consumers.reset.submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------- Editor ----------

function GroupEditor({
  mode,
  initial,
  brokers,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial: ConsumerGroupItem | null
  brokers: import('@generated/models').BrokerNode[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const masterBrokers = useMemo(
    () =>
      brokers.filter(
        (b) => String(b.role).toUpperCase() === 'MASTER' && b.status === 'online' && b.address,
      ),
    [brokers],
  )

  const [name, setName] = useState(initial?.group ?? '')
  const [brokerAddr, setBrokerAddr] = useState<string>(masterBrokers[0]?.address || '')
  const [consumeMode, setConsumeMode] = useState<ConsumeMode>(
    initial?.consumeMode || ConsumeMode.Clustering,
  )
  const [maxRetry, setMaxRetry] = useState<number>(initial?.maxRetry ?? 16)
  const [busy, setBusy] = useState(false)

  const isEdit = mode === 'edit'

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('consumers.edit.namePlaceholder'))
      return
    }
    if (!brokerAddr) {
      toast.error(t('consumers.edit.noBrokers'))
      return
    }
    setBusy(true)
    try {
      if (isEdit) {
        await consumerApi.updateConsumerGroup(name.trim(), brokerAddr, consumeMode, maxRetry)
        toast.success(t('consumers.edit.saveSuccess', { name: name.trim() }))
      } else {
        await consumerApi.createConsumerGroup(name.trim(), brokerAddr, consumeMode, maxRetry)
        toast.success(t('consumers.edit.createSuccess', { name: name.trim() }))
      }
      await onSaved()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-border/50 bg-background p-6 shadow-lg"
      >
        <h2 className="text-base font-semibold">
          {isEdit ? t('consumers.edit.title') : t('consumers.edit.createTitle')}
        </h2>
        <div className="mt-4 grid gap-3.5">
          <div>
            <div className="text-muted-foreground mb-2 text-[12px]">
              {t('consumers.edit.name')} <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
            </div>
            <Input
              className="font-mono-design"
              placeholder={t('consumers.edit.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
            />
          </div>
          <div>
            <div className="text-muted-foreground mb-2 text-[12px]">
              {t('consumers.edit.broker')}{' '}
              <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
            </div>
            {masterBrokers.length === 0 ? (
              <div className="text-muted-foreground text-[12px]" style={{ padding: 8 }}>
                {t('consumers.edit.noBrokers')}
              </div>
            ) : (
              <Select
                value={brokerAddr}
                onChange={(e) => setBrokerAddr(e.target.value)}
              >
                {masterBrokers.map((b) => (
                  <option key={b.address} value={b.address}>
                    {b.brokerName} · {b.address}
                  </option>
                ))}
              </Select>
            )}
            <div className="text-muted-foreground mt-1 text-[11px]">{t('consumers.edit.brokerHint')}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-2 text-[12px]">{t('consumers.edit.mode')}</div>
            <Select
              value={consumeMode}
              onChange={(e) => setConsumeMode(e.target.value as ConsumeMode)}
            >
              <option value={ConsumeMode.Clustering}>
                {t('consumers.detail.modeClustering')}
              </option>
              <option value={ConsumeMode.Broadcasting}>
                {t('consumers.detail.modeBroadcasting')}
              </option>
            </Select>
            <div className="text-muted-foreground mt-1 text-[11px]">{t('consumers.edit.modeHint')}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-2 text-[12px]">{t('consumers.edit.maxRetry')}</div>
            <Input
              type="number"
              min={0}
              max={64}
              value={maxRetry}
              onChange={(e) => setMaxRetry(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="outline" size="sm"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm"
            type="button"
            onClick={handleSubmit}
            disabled={busy || masterBrokers.length === 0}
          >
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {isEdit ? t('consumers.edit.submit') : t('consumers.edit.createSubmit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
