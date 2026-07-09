import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Plus, Tag, X, Server, Edit, Trash2, Check, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  TopicMessageType,
  TopicPerm,
  type TopicItem,
} from '../../../bindings/rocket-leaf/internal/model/models.js'
import { PageHeader } from '../shell'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTopics } from '@/hooks/useTopics'
import { useConsumers } from '@/hooks/useConsumers'
import { useCluster } from '@/hooks/useCluster'
import { useDelayedUnmount } from '@/hooks/useDelayedUnmount'
import * as topicApi from '@/api/topic'
import { formatErrorMessage } from '@/lib/utils'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { SlidingTabs } from '@/components/SlidingTabs'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'

type TypeFilter = 'all' | 'normal' | 'fifo' | 'delay' | 'retry' | 'dlq'
type TopicKind = 'normal' | 'fifo' | 'delay' | 'retry' | 'dlq'

const RETRY_PREFIX = '%RETRY%'
const DLQ_PREFIX = '%DLQ%'

interface DerivedTopic {
  raw: TopicItem
  kind: TopicKind
  system: boolean
}

/** Frontend safety net — backend also filters most system topics. */
function isLikelySystemTopic(name: string): boolean {
  const n = name.trim()
  if (!n) return true
  if (n.startsWith(RETRY_PREFIX) || n.startsWith(DLQ_PREFIX)) return false
  if (n.startsWith('RETRY%') || n.startsWith('DLQ%')) return false
  if (n.startsWith('%')) return true
  const u = n.toUpperCase()
  const l = n.toLowerCase()
  return (
    u.startsWith('RMQ_SYS_') ||
    l.startsWith('rmq_sys_') ||
    u.startsWith('SCHEDULE_TOPIC') ||
    n.startsWith('DefaultHeartBeat') ||
    u.includes('_REPLY_TOPIC') ||
    u.endsWith('REPLY_TOPIC') ||
    u.includes('WHEEL_TIMER') ||
    u.includes('REVIVE_LOG') ||
    u.includes('SYNC_BROKER_MEMBER') ||
    u.includes('ROCKSDB') ||
    u.includes('TRANS_HALF') ||
    [
      'TBW102',
      'BenchmarkTest',
      'DefaultCluster',
      'OFFSET_MOVED_EVENT',
      'SELF_TEST_TOPIC',
      'DefaultHeartBeatSyncerTopic',
    ].includes(n)
  )
}

function classifyTopic(t: TopicItem): TopicKind {
  if (t.topic.startsWith(RETRY_PREFIX) || t.topic.startsWith('RETRY%')) return 'retry'
  if (t.topic.startsWith(DLQ_PREFIX) || t.topic.startsWith('DLQ%')) return 'dlq'
  if (t.messageType === TopicMessageType.MessageTypeFIFO) return 'fifo'
  if (t.messageType === TopicMessageType.MessageTypeDelay) return 'delay'
  return 'normal'
}

function formatTps(n: number): string {
  if (!n || !Number.isFinite(n) || n < 0) return '—'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k/s`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k/s`
  return `${Math.round(n)}/s`
}

/** List API often returns -1 before detail/route load. */
function formatQueues(read: number, write: number): string {
  if (read < 0 && write < 0) return '—'
  if (read < 0) return `— / ${write}`
  if (write < 0) return `${read} / —`
  return `${read} / ${write}`
}

function permLabel(p: TopicPerm, t: (k: string) => string): string {
  switch (p) {
    case TopicPerm.PermRW:
      return t('topics.perm.rw')
    case TopicPerm.PermR:
      return t('topics.perm.r')
    case TopicPerm.PermW:
      return t('topics.perm.w')
    case TopicPerm.PermDeny:
      return t('topics.perm.deny')
    default:
      return p ? String(p) : '—'
  }
}

function typeBadgeClass(kind: TopicKind): string {
  switch (kind) {
    case 'fifo':
      return 'rl-badge rl-badge-topic-fifo'
    case 'delay':
      return 'rl-badge rl-badge-topic-delay'
    case 'retry':
      return 'rl-badge rl-badge-topic-retry'
    case 'dlq':
      return 'rl-badge rl-badge-topic-dlq'
    default:
      return 'rl-badge rl-badge-topic-normal'
  }
}

function typeLabel(kind: TopicKind, t: (k: string) => string): string {
  return t(`topics.type.${kind}`)
}

export function TopicsScreen() {
  const { t } = useTranslation()
  const { topics, loading, error, refresh, hasOnline } = useTopics()
  const { data: clusterData } = useCluster()

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [detail, setDetail] = useState<TopicItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState<
    { mode: 'create' } | { mode: 'edit'; topic: TopicItem } | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState<TopicItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const derived = useMemo<DerivedTopic[]>(
    () =>
      topics.map((raw) => ({
        raw,
        kind: classifyTopic(raw),
        system: isLikelySystemTopic(raw.topic),
      })),
    [topics],
  )

  const counts = useMemo(() => {
    const c = { all: 0, normal: 0, fifo: 0, delay: 0, retry: 0, dlq: 0 }
    for (const d of derived) {
      if (d.system) continue
      c.all++
      c[d.kind]++
    }
    return c
  }, [derived])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return derived
      .filter((d) => {
        // Hide internal system topics unless looking at retry/dlq intentionally
        if (d.system && d.kind !== 'retry' && d.kind !== 'dlq') return false
        if (typeFilter !== 'all' && d.kind !== typeFilter) return false
        if (
          q &&
          !d.raw.topic.toLowerCase().includes(q) &&
          !(d.raw.description || '').toLowerCase().includes(q)
        ) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        // Business topics first, then retry/dlq; alpha within group
        const rank = (k: TopicKind) =>
          k === 'normal' || k === 'fifo' || k === 'delay' ? 0 : k === 'retry' ? 1 : 2
        const ra = rank(a.kind)
        const rb = rank(b.kind)
        if (ra !== rb) return ra - rb
        return a.raw.topic.localeCompare(b.raw.topic)
      })
  }, [derived, search, typeFilter])

  const dismissPanel = useCallback(() => {
    setSelectedName(null)
  }, [])

  const panelMount = useDelayedUnmount(!!(hasOnline && selectedName))
  // Keep the displayed item alive during the exit animation.
  const [pinnedDetail, setPinnedDetail] = useState<TopicItem | null>(null)
  useEffect(() => {
    if (detail) setPinnedDetail(detail)
  }, [detail])

  // Esc closes the detail panel
  useEffect(() => {
    if (!selectedName) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissPanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedName, dismissPanel])

  // Clicking the list pane outside any row closes the panel
  const handleListBackgroundClick = (e: React.MouseEvent) => {
    if (!selectedName) return
    if ((e.target as HTMLElement).closest('tr')) return
    dismissPanel()
  }

  // When selected name changes, fetch detail (with routes)
  useEffect(() => {
    let cancelled = false
    if (!selectedName) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    topicApi
      .getTopicDetail(selectedName)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((e) => {
        if (!cancelled) toast.error(formatErrorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedName, topics.length]) // re-run when list refreshes too

  const doRefresh = useCallback(() => refresh({ silent: true }), [refresh])
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await topicApi.deleteTopic(confirmDelete.topic, confirmDelete.cluster || '')
      toast.success(t('topics.create.deleteSuccess'))
      setConfirmDelete(null)
      if (selectedName === confirmDelete.topic) setSelectedName(null)
      await refresh()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const subtitle = !hasOnline
    ? t('topics.subtitleNoConn')
    : search.trim() || typeFilter !== 'all'
      ? t('topics.subtitleFiltered', { count: filtered.length, total: counts.all })
      : t('topics.subtitle', { count: filtered.length })

  const filters: { key: TypeFilter; labelKey: string; count: number }[] = [
    { key: 'all', labelKey: 'topics.filterAll', count: counts.all },
    { key: 'normal', labelKey: 'topics.filterNormal', count: counts.normal },
    { key: 'fifo', labelKey: 'topics.filterFifo', count: counts.fifo },
    { key: 'delay', labelKey: 'topics.filterDelay', count: counts.delay },
    { key: 'retry', labelKey: 'topics.filterRetry', count: counts.retry },
    { key: 'dlq', labelKey: 'topics.filterDlq', count: counts.dlq },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('topics.title')} subtitle={subtitle}>
        <div className="rl-search-input" style={{ width: 220 }}>
          <span className="icon">
            <Search size={13} />
          </span>
          <input
            className="rl-input"
            placeholder={t('topics.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <RefreshButton spinning={isRefreshing} disabled={!hasOnline} onClick={handleRefresh} />
        <button
          className="rl-btn rl-btn-primary rl-btn-sm"
          onClick={() => setEditorOpen({ mode: 'create' })}
          disabled={!hasOnline}
        >
          <Plus size={13} />
          {t('common.create')}
        </button>
      </PageHeader>

      {hasOnline && (
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          <SlidingTabs
            value={typeFilter}
            onChange={setTypeFilter}
            items={filters.map((f) => ({
              key: f.key,
              label: t(f.labelKey),
              count: f.count,
            }))}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="scroll-thin min-w-0 flex-1 overflow-auto"
          onClick={handleListBackgroundClick}
        >
          {!hasOnline ? (
            <OfflineEmpty message={t('topics.subtitleNoConn')} />
          ) : loading && topics.length === 0 ? (
            <div className="rl-muted flex items-center justify-center gap-2 p-16">
              <Spinner size={14} />
              <span className="text-[12px]">{t('common.loading')}</span>
            </div>
          ) : (
            <>
              {error && <ErrorBanner message={t('topics.loadError', { message: error })} />}
              {filtered.length === 0 ? (
                <div className="rl-muted flex min-h-[200px] flex-col items-center justify-center gap-2 p-10 text-center">
                  <Tag size={22} className="opacity-35" />
                  <div className="text-[13px]">{t('topics.empty')}</div>
                  <div className="text-[11.5px]">{t('topics.emptyHint')}</div>
                  {typeFilter === 'all' && !search.trim() && (
                    <button
                      className="rl-btn rl-btn-primary rl-btn-sm mt-2"
                      onClick={() => setEditorOpen({ mode: 'create' })}
                    >
                      <Plus size={13} />
                      {t('common.create')}
                    </button>
                  )}
                </div>
              ) : (
                <table className="rl-table rl-table-topics">
                  <thead>
                    <tr>
                      <th>{t('topics.table.name')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ raw, kind }) => {
                      const selected = selectedName === raw.topic
                      return (
                        <tr
                          key={raw.topic}
                          className={selected ? 'selected' : ''}
                          onClick={() => setSelectedName(raw.topic)}
                        >
                          <td>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={
                                  'h-1.5 w-1.5 shrink-0 rounded-full ' +
                                  (kind === 'dlq'
                                    ? 'bg-[hsl(var(--destructive))]'
                                    : kind === 'retry'
                                      ? 'bg-[hsl(var(--warning))]'
                                      : kind === 'fifo'
                                        ? 'bg-[hsl(var(--warning))]'
                                        : kind === 'delay'
                                          ? 'bg-[hsl(var(--info))]'
                                          : 'bg-[hsl(var(--muted-foreground)/0.35)]')
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="font-mono-design truncate text-[12.5px] font-medium tracking-tight">
                                    {raw.topic}
                                  </span>
                                  <span className={typeBadgeClass(kind) + ' shrink-0'}>
                                    {typeLabel(kind, t)}
                                  </span>
                                </div>
                                {raw.description && (
                                  <div className="rl-muted mt-0.5 truncate text-[11px]">
                                    {raw.description}
                                  </div>
                                )}
                              </div>
                              <ChevronRight
                                size={14}
                                className={
                                  'rl-muted shrink-0 transition-opacity ' +
                                  (selected ? 'opacity-70' : 'opacity-35')
                                }
                                aria-hidden
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        {panelMount.shouldRender && (
          <TopicDetailPanel
            topic={detail ?? pinnedDetail}
            loading={detailLoading && !detail && !pinnedDetail}
            exiting={panelMount.exiting}
            onClose={dismissPanel}
            onEdit={(tp) => setEditorOpen({ mode: 'edit', topic: tp })}
            onDelete={(tp) => setConfirmDelete(tp)}
          />
        )}
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <TopicEditor
          mode={editorOpen.mode}
          initial={editorOpen.mode === 'edit' ? editorOpen.topic : null}
          brokers={clusterData.brokers}
          onClose={() => setEditorOpen(null)}
          onSaved={async () => {
            setEditorOpen(null)
            await refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={t('topics.detail.actions.delete')}
        description={t('topics.detail.deleteConfirm', { name: confirmDelete?.topic ?? '' })}
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

function TopicDetailPanel({
  topic,
  loading,
  exiting,
  onClose,
  onEdit,
  onDelete,
}: {
  topic: TopicItem | null
  loading: boolean
  exiting: boolean
  onClose: () => void
  onEdit: (t: TopicItem) => void
  onDelete: (t: TopicItem) => void
}) {
  const { t } = useTranslation()
  const { groups: consumerGroups, loading: groupsLoading } = useConsumers()
  const [tab, setTab] = useState<'info' | 'routes' | 'groups'>('info')

  const relatedGroups = useMemo(() => {
    if (!topic) return []
    const name = topic.topic
    return consumerGroups.filter((g) => (g.subscriptions || []).some((s) => s.topic === name))
  }, [consumerGroups, topic])

  const asideClass = 'scroll-thin rl-detail-panel' + (exiting ? ' exiting' : '')

  if (loading && !topic) {
    return (
      <aside
        className={asideClass}
        style={{
          width: 380,
          borderLeft: '1px solid hsl(var(--border))',
          overflow: 'auto',
          background: 'hsl(var(--background))',
        }}
      >
        <div className="rl-muted flex items-center justify-center" style={{ padding: 60, gap: 8 }}>
          <Spinner size={14} />
          <span className="text-[12px]">{t('common.loading')}</span>
        </div>
      </aside>
    )
  }

  if (!topic) return null

  const kind = classifyTopic(topic)
  const queueLabel = formatQueues(topic.readQueue, topic.writeQueue)
  const totalQueue =
    topic.readQueue >= 0 && topic.writeQueue >= 0 ? topic.readQueue + topic.writeQueue : null

  return (
    <aside
      className={asideClass}
      style={{
        width: 360,
        borderLeft: '1px solid hsl(var(--border))',
        overflow: 'auto',
        background: 'hsl(var(--background))',
      }}
    >
      <div style={{ padding: 16 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono-design truncate text-[14px] font-semibold tracking-tight">
              {topic.topic}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={typeBadgeClass(kind)}>{typeLabel(kind, t)}</span>
              {topic.perm && (
                <span className="rl-badge rl-badge-outline">{permLabel(topic.perm, t)}</span>
              )}
            </div>
          </div>
          <button className="rl-btn rl-btn-ghost rl-btn-icon rl-btn-sm shrink-0" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div
          className="rl-utabs"
          style={{
            marginTop: 16,
            marginLeft: -20,
            marginRight: -20,
            paddingLeft: 20,
            paddingRight: 20,
          }}
        >
          {(['info', 'routes', 'groups'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={'utab ' + (tab === k ? 'active' : '')}
              onClick={() => setTab(k)}
            >
              {t(`topics.detail.tabs.${k}`)}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rl-stat">
                <div className="label">{t('topics.detail.stat.queues')}</div>
                <div className="value text-[18px]">{totalQueue != null ? totalQueue : '—'}</div>
                <div className="rl-muted mt-0.5 text-[11px]">{queueLabel}</div>
              </div>
              <div className="rl-stat">
                <div className="label">{t('topics.detail.stat.groups')}</div>
                <div className="value text-[18px]">{topic.consumerGroups || 0}</div>
              </div>
              <div className="rl-stat">
                <div className="label">{t('topics.detail.stat.tpsIn')}</div>
                <div className="value text-[16px]">{formatTps(topic.tpsIn)}</div>
              </div>
              <div className="rl-stat">
                <div className="label">{t('topics.detail.stat.tpsOut')}</div>
                <div className="value text-[16px]">{formatTps(topic.tpsOut)}</div>
              </div>
            </div>

            <div className="rl-section-label mt-4">{t('topics.detail.info')}</div>
            <div>
              {topic.cluster && (
                <div className="rl-detail-row">
                  <div className="k">{t('topics.detail.infoCluster')}</div>
                  <div className="v">{topic.cluster}</div>
                </div>
              )}
              <div className="rl-detail-row">
                <div className="k">{t('topics.detail.infoType')}</div>
                <div className="v">{typeLabel(kind, t)}</div>
              </div>
              <div className="rl-detail-row">
                <div className="k">{t('topics.detail.infoPerm')}</div>
                <div className="v">{permLabel(topic.perm, t)}</div>
              </div>
              <div className="rl-detail-row">
                <div className="k">{t('topics.detail.infoQueues')}</div>
                <div className="v rl-tabular">{queueLabel}</div>
              </div>
              {topic.lastUpdated && (
                <div className="rl-detail-row">
                  <div className="k">{t('topics.detail.infoUpdated')}</div>
                  <div className="v font-mono-design text-[12px]">{topic.lastUpdated}</div>
                </div>
              )}
              {topic.description && (
                <div className="rl-detail-row">
                  <div className="k">{t('topics.detail.infoDesc')}</div>
                  <div className="v">{topic.description}</div>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'routes' && (
          <div className="mt-4">
            {topic.routes.length === 0 ? (
              <div className="rl-muted text-[12px]" style={{ padding: 16, textAlign: 'center' }}>
                {t('topics.detail.routesEmpty')}
              </div>
            ) : (
              <div className="rl-card overflow-hidden">
                {topic.routes.map((r, i) => (
                  <div
                    key={`${r.broker}-${r.brokerAddr}`}
                    className="flex items-center justify-between"
                    style={{
                      padding: '10px 14px',
                      borderTop: i ? '1px solid hsl(var(--border))' : undefined,
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Server size={13} className="rl-muted" />
                      <span className="font-mono-design truncate text-[12px]">{r.broker}</span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <span
                        className="rl-badge rl-badge-outline"
                        style={{ height: 18, fontSize: 10 }}
                      >
                        R {r.readQueue}
                      </span>
                      <span
                        className="rl-badge rl-badge-outline"
                        style={{ height: 18, fontSize: 10 }}
                      >
                        W {r.writeQueue}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'groups' && (
          <div className="mt-4">
            {groupsLoading && relatedGroups.length === 0 ? (
              <div className="rl-muted flex items-center justify-center gap-2 py-8 text-[12px]">
                <Spinner size={14} />
                {t('common.loading')}
              </div>
            ) : relatedGroups.length === 0 ? (
              <div className="rl-card" style={{ padding: 16, textAlign: 'center' }}>
                <div className="rl-muted text-[12px]">{t('topics.detail.groupsEmpty')}</div>
              </div>
            ) : (
              <div className="rl-card overflow-hidden">
                <div
                  className="rl-muted px-3.5 py-2 text-[11px]"
                  style={{ borderBottom: '1px solid hsl(var(--border))' }}
                >
                  {t('topics.detail.groupsTitle')} · {relatedGroups.length}
                </div>
                {relatedGroups.map((g, i) => (
                  <div
                    key={g.group}
                    className="flex items-center justify-between gap-2"
                    style={{
                      padding: '10px 14px',
                      borderTop: i ? '1px solid hsl(var(--border))' : undefined,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono-design truncate text-[12px] font-medium">
                        {g.group}
                      </div>
                      <div className="rl-muted mt-0.5 text-[11px]">
                        {t('common.instances', { count: g.onlineClients ?? 0 })}
                        {' · '}
                        lag {(g.lag ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={
                        g.status === 'online'
                          ? 'rl-badge rl-badge-success'
                          : g.status === 'warning'
                            ? 'rl-badge rl-badge-warn'
                            : 'rl-badge rl-badge-outline'
                      }
                    >
                      {g.status || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button className="rl-btn rl-btn-outline rl-btn-sm" onClick={() => onEdit(topic)}>
            <Edit size={13} />
            {t('topics.detail.actions.edit')}
          </button>
          <button
            className="rl-btn rl-btn-ghost rl-btn-sm"
            style={{ marginLeft: 'auto', color: 'hsl(var(--destructive))' }}
            onClick={() => onDelete(topic)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}

// ---------- Editor Modal ----------

function TopicEditor({
  mode,
  initial,
  brokers,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial: TopicItem | null
  brokers: import('../../../bindings/rocket-leaf/internal/model/models.js').BrokerNode[]
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

  const [name, setName] = useState(initial?.topic ?? '')
  const [brokerAddr, setBrokerAddr] = useState<string>(
    initial?.routes?.[0]?.brokerAddr || masterBrokers[0]?.address || '',
  )
  const [readQueue, setReadQueue] = useState<number>(initial?.readQueue ?? 8)
  const [writeQueue, setWriteQueue] = useState<number>(initial?.writeQueue ?? 8)
  const [perm, setPerm] = useState<TopicPerm>(initial?.perm ?? TopicPerm.PermRW)
  const [busy, setBusy] = useState(false)

  const isEdit = mode === 'edit'

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('topics.create.namePlaceholder'))
      return
    }
    if (!brokerAddr) {
      toast.error(t('topics.create.noBrokers'))
      return
    }
    setBusy(true)
    try {
      if (isEdit) {
        await topicApi.updateTopic(name.trim(), brokerAddr, readQueue, writeQueue, perm)
        toast.success(t('topics.create.saveSuccess', { name: name.trim() }))
      } else {
        await topicApi.createTopic(name.trim(), brokerAddr, readQueue, writeQueue, perm)
        toast.success(t('topics.create.createSuccess', { name: name.trim() }))
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
          {isEdit ? t('topics.create.edit') : t('topics.create.title')}
        </h2>
        <div className="mt-4 grid gap-3.5" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            <div className="rl-muted mb-2 text-[12px]">
              {t('topics.create.name')} <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
            </div>
            <input
              className="rl-input font-mono-design"
              placeholder={t('topics.create.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
            />
          </div>
          <div>
            <div className="rl-muted mb-2 text-[12px]">
              {t('topics.create.broker')}{' '}
              <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
            </div>
            {masterBrokers.length === 0 ? (
              <div className="rl-muted text-[12px]" style={{ padding: 8 }}>
                {t('topics.create.noBrokers')}
              </div>
            ) : (
              <select
                className="rl-select"
                value={brokerAddr}
                onChange={(e) => setBrokerAddr(e.target.value)}
              >
                {masterBrokers.map((b) => (
                  <option key={b.address} value={b.address}>
                    {b.brokerName} · {b.address}
                  </option>
                ))}
              </select>
            )}
            <div className="rl-muted mt-1 text-[11px]">{t('topics.create.brokerHint')}</div>
          </div>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="rl-muted mb-2 text-[12px]">{t('topics.create.readQueue')}</div>
              <input
                className="rl-input"
                type="number"
                min={1}
                max={64}
                value={readQueue}
                onChange={(e) => setReadQueue(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <div className="rl-muted mb-2 text-[12px]">{t('topics.create.writeQueue')}</div>
              <input
                className="rl-input"
                type="number"
                min={1}
                max={64}
                value={writeQueue}
                onChange={(e) => setWriteQueue(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <div>
            <div className="rl-muted mb-2 text-[12px]">{t('topics.create.perm')}</div>
            <select
              className="rl-select"
              value={perm}
              onChange={(e) => setPerm(e.target.value as TopicPerm)}
            >
              <option value={TopicPerm.PermRW}>{t('topics.perm.rw')}</option>
              <option value={TopicPerm.PermR}>{t('topics.perm.r')}</option>
              <option value={TopicPerm.PermW}>{t('topics.perm.w')}</option>
              <option value={TopicPerm.PermDeny}>{t('topics.perm.deny')}</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            className="rl-btn rl-btn-outline rl-btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rl-btn rl-btn-primary rl-btn-sm"
            onClick={handleSubmit}
            disabled={busy || masterBrokers.length === 0}
          >
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {isEdit ? t('topics.create.save') : t('topics.create.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
