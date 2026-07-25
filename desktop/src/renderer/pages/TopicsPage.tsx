import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Plus, Tag, X, Server, Edit, Trash2, Check, ChevronRight, Send } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TopicMessageType, TopicPerm, type TopicItem } from '@generated/models'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Modal } from '@/components/ui/modal'
import { useTopics } from '@/hooks/useTopics'
import { useConsumers } from '@/hooks/useConsumers'
import { useCluster } from '@/hooks/useCluster'
import { useDelayedUnmount } from '@/hooks/useDelayedUnmount'
import * as topicApi from '@/api/topic'
import { cn, formatErrorMessage } from '@/lib/utils'
import { activatableRowProps, ROW_FOCUS_CLASS } from '@/lib/a11y'
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

type TypeFilter = 'all' | 'normal' | 'retry' | 'dlq'
type TopicKind = 'normal' | 'fifo' | 'delay' | 'retry' | 'dlq'

/** Shared grid template for the topics table header + rows. */
const TOPIC_COLS = 'minmax(0,1fr) 88px 64px 96px 72px 28px'

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
  if (t.messageType === TopicMessageType.FIFO) return 'fifo'
  if (t.messageType === TopicMessageType.Delay) return 'delay'
  return 'normal'
}

/** Negative means the brokers never reported the metric — not "idle". */
function formatTps(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k/s`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k/s`
  return `${Math.round(n)}/s`
}

/** Same convention as formatTps: -1 is unknown, 0 is a real measurement. */
function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  return String(n)
}

/** List API returns -1 for any field the brokers did not answer for. */
function formatQueues(read: number, write: number): string {
  if (read < 0 && write < 0) return '—'
  if (read < 0) return `— / ${write}`
  if (write < 0) return `${read} / —`
  return `${read} / ${write}`
}

/**
 * "普通" covers every business topic, ordered and delayed included, so the tab
 * counts always add up to the "全部" total.
 */
function matchesFilter(kind: TopicKind, filter: TypeFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'normal') return kind === 'normal' || kind === 'fifo' || kind === 'delay'
  return kind === filter
}

function permLabel(p: TopicPerm, t: (k: string) => string): string {
  switch (p) {
    case TopicPerm.ReadWrite:
      return t('topics.perm.rw')
    case TopicPerm.ReadOnly:
      return t('topics.perm.r')
    case TopicPerm.WriteOnly:
      return t('topics.perm.w')
    case TopicPerm.Deny:
      return t('topics.perm.deny')
    default:
      return p ? String(p) : '—'
  }
}

function typeBadgeClass(kind: TopicKind): string {
  // Topic-type colors stay as utility classes on Badge.
  switch (kind) {
    case 'fifo':
      return 'rl-badge-topic-fifo'
    case 'delay':
      return 'rl-badge-topic-delay'
    case 'retry':
      return 'rl-badge-topic-retry'
    case 'dlq':
      return 'rl-badge-topic-dlq'
    default:
      return 'rl-badge-topic-normal'
  }
}

function typeLabel(kind: TopicKind, t: (k: string) => string): string {
  return t(`topics.type.${kind}`)
}

export function TopicsPage({ onNavigate }: { onNavigate?: (id: NavId) => void }) {
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
    const c = { all: 0, normal: 0, retry: 0, dlq: 0 }
    for (const d of derived) {
      if (d.system) continue
      c.all++
      if (d.kind === 'retry') c.retry++
      else if (d.kind === 'dlq') c.dlq++
      else c.normal++
    }
    return c
  }, [derived])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return derived
      .filter((d) => {
        // Hide internal system topics unless looking at retry/dlq intentionally
        if (d.system && d.kind !== 'retry' && d.kind !== 'dlq') return false
        if (!matchesFilter(d.kind, typeFilter)) return false
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
    if ((e.target as HTMLElement).closest('[data-topic-row]')) return
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
        if (!cancelled) {
          setDetail(null)
          toast.error(formatErrorMessage(e))
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedName, topics]) // Sync detail after list refresh (including same-count content updates)

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
    { key: 'retry', labelKey: 'topics.filterRetry', count: counts.retry },
    { key: 'dlq', labelKey: 'topics.filterDlq', count: counts.dlq },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('topics.title')} subtitle={subtitle}>
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
        <div className="flex items-center gap-2.5 border-b border-border/80 px-5 py-3">
          <div className="relative" style={{ width: 260 }}>
            <span className="pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 text-muted-foreground">
              <Search size={13} />
            </span>
            <Input
              className="pl-8"
              placeholder={t('topics.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SlidingTabs
            value={typeFilter}
            onChange={setTypeFilter}
            items={filters.map((f) => ({
              key: f.key,
              label: t(f.labelKey),
              count: f.count,
            }))}
          />
          <div className="flex-1" />
          <span className="text-muted-foreground shrink-0 text-fs-115 tabular-nums">
            {t('topics.resultCount', { count: filtered.length })}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="scroll-thin min-w-0 flex-1 overflow-auto"
          onClick={handleListBackgroundClick}
        >
          {!hasOnline ? (
            <OfflineEmpty
              message={t('topics.subtitleNoConn')}
              onAction={() => onNavigate?.('connections')}
            />
          ) : loading && topics.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-16">
              <Spinner size={14} />
              <span className="text-fs-12">{t('common.loading')}</span>
            </div>
          ) : (
            <>
              {error && <ErrorBanner message={t('topics.loadError', { message: error })} />}
              {filtered.length === 0 ? (
                <div className="text-muted-foreground flex min-h-[200px] flex-col items-center justify-center gap-2 p-10 text-center">
                  <Tag size={22} className="opacity-35" />
                  <div className="text-fs-13">{t('topics.empty')}</div>
                  <div className="text-fs-115">{t('topics.emptyHint')}</div>
                  {typeFilter === 'all' && !search.trim() && (
                    <Button variant="default" size="sm"
                      className="mt-2"
                      onClick={() => setEditorOpen({ mode: 'create' })}
                    >
                      <Plus size={13} />
                      {t('common.create')}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="px-5 pb-5 pt-3">
                  <div
                    className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-card"
                    style={{ minWidth: 640 }}
                  >
                    <div
                      className="text-muted-foreground grid items-center gap-2 border-b border-border px-3.5 py-2 text-fs-11 font-medium"
                      style={{ gridTemplateColumns: TOPIC_COLS }}
                    >
                      <span>{t('topics.table.name')}</span>
                      <span className="text-right">{t('topics.table.queues')}</span>
                      <span>{t('topics.table.perm')}</span>
                      <span>{t('topics.table.tpsIn')}</span>
                      <span className="text-right">{t('topics.table.groups')}</span>
                      <span />
                    </div>
                    {filtered.map(({ raw, kind }) => {
                      const selected = selectedName === raw.topic
                      return (
                        <div
                          key={raw.topic}
                          data-topic-row
                          role="button"
                          aria-current={selected || undefined}
                          onClick={() => setSelectedName(raw.topic)}
                          {...activatableRowProps(() => setSelectedName(raw.topic))}
                          className={cn(
                            'grid cursor-pointer items-center gap-2 border-t border-border px-3.5 py-2.5 transition-colors hover:bg-muted',
                            ROW_FOCUS_CLASS,
                            selected && 'bg-accent hover:bg-accent',
                          )}
                          style={{ gridTemplateColumns: TOPIC_COLS }}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-mono-design truncate text-fs-12">{raw.topic}</span>
                            <Badge variant="outline" className={typeBadgeClass(kind) + ' shrink-0'}>
                              {typeLabel(kind, t)}
                            </Badge>
                          </div>
                          <span className="font-mono-design text-right text-fs-12 tabular-nums">
                            {formatQueues(raw.readQueue, raw.writeQueue)}
                          </span>
                          <span className="text-muted-foreground text-fs-115">
                            {permLabel(raw.perm, t)}
                          </span>
                          <span className="font-mono-design text-muted-foreground text-fs-115 tabular-nums">
                            {formatTps(raw.tpsIn)}
                          </span>
                          <span className="font-mono-design text-muted-foreground text-right text-fs-12 tabular-nums">
                            {formatCount(raw.consumerGroups)}
                          </span>
                          <ChevronRight
                            size={14}
                            className={cn(
                              'text-muted-foreground shrink-0 justify-self-end transition-opacity',
                              selected ? 'opacity-70' : 'opacity-50',
                            )}
                            aria-hidden
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
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
            onSend={() => onNavigate?.('producer')}
            onBrowse={() => onNavigate?.('messages')}
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
  onSend,
  onBrowse,
}: {
  topic: TopicItem | null
  loading: boolean
  exiting: boolean
  onClose: () => void
  onEdit: (t: TopicItem) => void
  onDelete: (t: TopicItem) => void
  onSend: (t: TopicItem) => void
  onBrowse: (t: TopicItem) => void
}) {
  const { t } = useTranslation()
  const { groups: consumerGroups, loading: groupsLoading } = useConsumers()
  const [tab, setTab] = useState<'info' | 'routes' | 'groups'>('info')

  const relatedGroups = useMemo(() => {
    if (!topic) return []
    const name = topic.topic
    return consumerGroups.filter((g) => (g.subscriptions || []).some((s) => s.topic === name))
  }, [consumerGroups, topic])

  const asideClass = 'scroll-thin detail-panel' + (exiting ? ' exiting' : '')

  if (loading && !topic) {
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
        <div className="text-muted-foreground flex items-center justify-center" style={{ padding: 60, gap: 8 }}>
          <Spinner size={14} />
          <span className="text-fs-12">{t('common.loading')}</span>
        </div>
      </aside>
    )
  }

  if (!topic) return null

  const kind = classifyTopic(topic)
  const queueLabel = formatQueues(topic.readQueue, topic.writeQueue)
  // Routes carry each broker's own queue counts. The stat reports the number of
  // readable queues across the cluster; the sub-label keeps the per-broker R/W
  // setting, which is what the edit form writes back.
  const totalQueue = topic.routes.length
    ? topic.routes.reduce((sum, r) => sum + Math.max(0, r.readQueue), 0)
    : topic.readQueue >= 0
      ? topic.readQueue
      : null

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
      <div style={{ padding: 20 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono-design truncate text-fs-14 font-semibold tracking-tight">
              {topic.topic}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant="outline" className={typeBadgeClass(kind)}>
                {typeLabel(kind, t)}
              </Badge>
              {topic.perm && (
                <Badge variant="outline">{permLabel(topic.perm, t)}</Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        <div
          className="utabs"
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
              <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card">
                <div className="flex items-center gap-1.5 text-fs-115 text-muted-foreground">{t('topics.detail.stat.queues')}</div>
                <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight text-fs-18">{totalQueue != null ? totalQueue : '—'}</div>
                <div className="text-muted-foreground mt-0.5 text-fs-11">{queueLabel}</div>
              </div>
              <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card">
                <div className="flex items-center gap-1.5 text-fs-115 text-muted-foreground">{t('topics.detail.stat.groups')}</div>
                <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight text-fs-18">{formatCount(topic.consumerGroups)}</div>
              </div>
              <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card">
                <div className="flex items-center gap-1.5 text-fs-115 text-muted-foreground">{t('topics.detail.stat.tpsIn')}</div>
                <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight text-fs-16">{formatTps(topic.tpsIn)}</div>
              </div>
              <div className="rounded-xl border border-border/80 bg-card p-3.5 shadow-card">
                <div className="flex items-center gap-1.5 text-fs-115 text-muted-foreground">{t('topics.detail.stat.tpsOut')}</div>
                <div className="mt-1 font-semibold tracking-tight tabular-nums leading-tight text-fs-16">{formatTps(topic.tpsOut)}</div>
              </div>
            </div>

            <div className="mb-2.5 text-fs-11 font-semibold uppercase tracking-[0.08em] text-muted-foreground mt-4">{t('topics.detail.info')}</div>
            <div>
              {topic.cluster && (
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
                  <div className="text-muted-foreground">{t('topics.detail.infoCluster')}</div>
                  <div className="text-foreground">{topic.cluster}</div>
                </div>
              )}
              <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
                <div className="text-muted-foreground">{t('topics.detail.infoType')}</div>
                <div className="text-foreground">{typeLabel(kind, t)}</div>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
                <div className="text-muted-foreground">{t('topics.detail.infoPerm')}</div>
                <div className="text-foreground">{permLabel(topic.perm, t)}</div>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
                <div className="text-muted-foreground">{t('topics.detail.infoQueues')}</div>
                <div className="text-foreground tabular-nums">{queueLabel}</div>
              </div>
              {topic.lastUpdated && (
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
                  <div className="text-muted-foreground">{t('topics.detail.infoUpdated')}</div>
                  <div className="text-foreground font-mono-design text-fs-12">{topic.lastUpdated}</div>
                </div>
              )}
              {topic.description && (
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
                  <div className="text-muted-foreground">{t('topics.detail.infoDesc')}</div>
                  <div className="text-foreground">{topic.description}</div>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'routes' && (
          <div className="mt-4">
            {topic.routes.length === 0 ? (
              <div className="text-muted-foreground text-fs-12" style={{ padding: 16, textAlign: 'center' }}>
                {t('topics.detail.routesEmpty')}
              </div>
            ) : (
              <Card className="overflow-hidden">
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
                      <Server size={13} className="text-muted-foreground" />
                      <span className="font-mono-design truncate text-fs-12">{r.broker}</span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Badge variant="outline" className="text-fs-10">
                        R {r.readQueue}
                      </Badge>
                      <Badge variant="outline" className="text-fs-10">
                        W {r.writeQueue}
                      </Badge>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}

        {tab === 'groups' && (
          <div className="mt-4">
            {groupsLoading && relatedGroups.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-fs-12">
                <Spinner size={14} />
                {t('common.loading')}
              </div>
            ) : relatedGroups.length === 0 ? (
              <Card style={{ padding: 16, textAlign: 'center' }}>
                <div className="text-muted-foreground text-fs-12">{t('topics.detail.groupsEmpty')}</div>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div
                  className="text-muted-foreground px-3.5 py-2 text-fs-11"
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
                      <div className="font-mono-design truncate text-fs-12 font-medium">
                        {g.group}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-fs-11">
                        {t('common.instances', { count: g.onlineClients ?? 0 })}
                        {' · '}
                        lag {(g.lag ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <Badge
                      variant={
                        g.status === 'online'
                          ? 'success'
                          : g.status === 'warning'
                            ? 'warning'
                            : 'outline'
                      }
                    >
                      {g.status || '—'}
                    </Badge>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="default" size="sm" className="flex-1" onClick={() => onSend(topic)}>
              <Send size={13} />
              {t('topics.detail.actions.send')}
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => onBrowse(topic)}>
              {t('topics.detail.actions.messages')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(topic)}>
              <Edit size={13} />
              {t('topics.detail.actions.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              style={{ color: 'hsl(var(--destructive))' }}
              onClick={() => onDelete(topic)}
            >
              <Trash2 size={13} />
              {t('topics.detail.actions.delete')}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ---------- Editor Modal ----------

const DEFAULT_QUEUE_COUNT = 8

/**
 * Queue counts live in each broker's own topic config, so the form must show
 * the numbers belonging to the broker it is about to write to. Falling back to
 * the topic-level summary keeps create mode and route-less items working.
 */
function queuesForBroker(
  topic: TopicItem | null,
  address: string,
): { read: number; write: number } {
  const route = topic?.routes?.find((r) => r.brokerAddr === address)
  if (route) return { read: route.readQueue, write: route.writeQueue }
  const read = topic?.readQueue ?? -1
  const write = topic?.writeQueue ?? -1
  return {
    read: read > 0 ? read : DEFAULT_QUEUE_COUNT,
    write: write > 0 ? write : DEFAULT_QUEUE_COUNT,
  }
}

function TopicEditor({
  mode,
  initial,
  brokers,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial: TopicItem | null
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

  // The submit only ever targets one broker, so preselect a broker that the
  // select can actually show. Cluster data loads asynchronously, which is why
  // this is recomputed rather than captured once at mount.
  const defaultBroker = useMemo(() => {
    const options = masterBrokers.map((b) => b.address)
    const routed = (initial?.routes ?? [])
      .map((r) => r.brokerAddr)
      .find((address) => address && options.includes(address))
    return routed || options[0] || ''
  }, [initial, masterBrokers])

  const isEdit = mode === 'edit'

  const [name, setName] = useState(initial?.topic ?? '')
  const [brokerAddr, setBrokerAddr] = useState<string>(defaultBroker)
  const [readQueue, setReadQueue] = useState<number>(() => queuesForBroker(initial, defaultBroker).read)
  const [writeQueue, setWriteQueue] = useState<number>(
    () => queuesForBroker(initial, defaultBroker).write,
  )
  const [perm, setPerm] = useState<TopicPerm>(initial?.perm || TopicPerm.ReadWrite)
  const [busy, setBusy] = useState(false)

  // Never leave the form holding an address the select cannot display, or the
  // user would be submitting a broker other than the one shown.
  useEffect(() => {
    setBrokerAddr((current) =>
      current && masterBrokers.some((b) => b.address === current) ? current : defaultBroker,
    )
  }, [defaultBroker, masterBrokers])

  // Queue counts are a per-broker setting. Re-read them whenever the target
  // broker changes, so saving cannot copy one broker's numbers onto another.
  useEffect(() => {
    if (!isEdit) return
    const queues = queuesForBroker(initial, brokerAddr)
    setReadQueue(queues.read)
    setWriteQueue(queues.write)
  }, [isEdit, initial, brokerAddr])

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
    <Modal
      open
      title={isEdit ? t('topics.create.edit') : t('topics.create.title')}
      dismissible={!busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" type="button" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={handleSubmit}
            disabled={busy || masterBrokers.length === 0}
          >
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {isEdit ? t('topics.create.save') : t('topics.create.submit')}
          </Button>
        </>
      }
    >
      <div className="mt-4 grid gap-3.5">
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t('topics.create.name')} <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
          </div>
          <Input
            className="font-mono-design"
            placeholder={t('topics.create.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t('topics.create.broker')}{' '}
            <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
          </div>
          {masterBrokers.length === 0 ? (
            <div className="text-muted-foreground text-fs-12" style={{ padding: 8 }}>
              {t('topics.create.noBrokers')}
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
          <div className="text-muted-foreground mt-1 text-fs-11">{t('topics.create.brokerHint')}</div>
        </div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="text-muted-foreground mb-2 text-fs-12">{t('topics.create.readQueue')}</div>
            <Input
              type="number"
              min={1}
              max={64}
              value={readQueue}
              onChange={(e) => setReadQueue(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <div className="text-muted-foreground mb-2 text-fs-12">{t('topics.create.writeQueue')}</div>
            <Input
              type="number"
              min={1}
              max={64}
              value={writeQueue}
              onChange={(e) => setWriteQueue(Number(e.target.value) || 1)}
            />
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">{t('topics.create.perm')}</div>
          <Select
            value={perm}
            onChange={(e) => setPerm(e.target.value as TopicPerm)}
          >
            <option value={TopicPerm.ReadWrite}>{t('topics.perm.rw')}</option>
            <option value={TopicPerm.ReadOnly}>{t('topics.perm.r')}</option>
            <option value={TopicPerm.WriteOnly}>{t('topics.perm.w')}</option>
            <option value={TopicPerm.Deny}>{t('topics.perm.deny')}</option>
          </Select>
        </div>
      </div>
    </Modal>
  )
}
