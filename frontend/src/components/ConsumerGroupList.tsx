import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Search, X, Trash2, Loader2, AlertTriangle, BarChart3, RotateCcw, Pencil } from 'lucide-react'
import { cn, formatErrorMessage } from '@/lib/utils'
import type { ConsumerGroupItem } from '../../bindings/rocket-leaf/internal/model/models.js'
import { GroupStatus, ConsumeMode } from '../../bindings/rocket-leaf/internal/model/models.js'

const CONSUME_MODE_OPTIONS: { value: ConsumeMode; label: string }[] = [
  { value: ConsumeMode.ModeClustering, label: '集群 (Clustering)' },
  { value: ConsumeMode.ModeBroadcasting, label: '广播 (Broadcasting)' },
]
import * as consumerApi from '@/api/consumer'

const TOOLTIP_DELAY_MS = 150
const MIN_SPIN_MS = 400

type Props = {
  list: ConsumerGroupItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void | Promise<void>
}

type ConsumeStats = {
  group: string
  consumeTps: number
  diffTotal: number
}

function toDateTimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60 * 1000)
  return localDate.toISOString().slice(0, 16)
}

function getDefaultResetTimeValue(): string {
  return toDateTimeLocalValue(new Date())
}

function parseConsumeStats(data: Record<string, unknown>): ConsumeStats {
  return {
    group: typeof data.group === 'string' ? data.group : '',
    consumeTps: typeof data.consumeTps === 'number' ? data.consumeTps : 0,
    diffTotal: typeof data.diffTotal === 'number' ? data.diffTotal : 0,
  }
}

export function ConsumerGroupList({ list, loading, error, onRefresh }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showTooltip, setShowTooltip] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConsumerGroupItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [stats, setStats] = useState<ConsumeStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editConsumeMode, setEditConsumeMode] = useState<string>(ConsumeMode.ModeClustering)
  const [editMaxRetry, setEditMaxRetry] = useState(16)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetTopic, setResetTopic] = useState('')
  const [resetTimestamp, setResetTimestamp] = useState(getDefaultResetTimeValue())
  const [resetForce, setResetForce] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spinEndRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSpinning = loading || refreshing

  const filteredList = searchQuery.trim()
    ? list.filter((g) => (g.group ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : list

  useEffect(() => {
    if (!loading && refreshing) {
      if (error) toast.error(error)
      else toast.success('已刷新')
      if (spinEndRef.current) clearTimeout(spinEndRef.current)
      spinEndRef.current = setTimeout(() => {
        setRefreshing(false)
        spinEndRef.current = null
      }, MIN_SPIN_MS)
    }
    return () => {
      if (spinEndRef.current) clearTimeout(spinEndRef.current)
    }
  }, [loading, refreshing, error])

  const loadDetail = useCallback(async (groupName: string, cancelledRef?: { current: boolean }) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const data = await consumerApi.getConsumerGroupDetail(groupName)
      if (cancelledRef?.current) return
      setDetail(data ?? null)
      setDetailError(data ? null : '未获取到详情')
    } catch (e) {
      if (cancelledRef?.current) return
      setDetailError(e instanceof Error ? e.message : String(e))
      setDetail(null)
    } finally {
      if (!cancelledRef?.current) setDetailLoading(false)
    }
  }, [])

  const loadStats = useCallback(async (groupName: string, cancelledRef?: { current: boolean }) => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const data = await consumerApi.getConsumeStats(groupName)
      if (cancelledRef?.current) return
      setStats(parseConsumeStats(data))
    } catch (e) {
      if (cancelledRef?.current) return
      setStats(null)
      setStatsError(formatErrorMessage(e))
    } finally {
      if (!cancelledRef?.current) setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedGroup) {
      setDetail(null)
      setDetailError(null)
      setStats(null)
      setStatsError(null)
      return
    }

    const cancelledRef = { current: false }
    void loadDetail(selectedGroup, cancelledRef)
    void loadStats(selectedGroup, cancelledRef)

    return () => {
      cancelledRef.current = true
    }
  }, [loadDetail, loadStats, selectedGroup])

  const onEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setShowTooltip(true), TOOLTIP_DELAY_MS)
  }, [])
  const onLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setShowTooltip(false)
  }, [])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    void Promise.resolve(onRefresh())
  }, [onRefresh])

  const handleOpenResetDialog = useCallback(() => {
    const firstTopic = detail?.subscriptions?.find((sub) => (sub.topic ?? '').trim() !== '')?.topic ?? ''
    setResetTopic(firstTopic)
    setResetTimestamp(getDefaultResetTimeValue())
    setResetForce(false)
    setResetDialogOpen(true)
  }, [detail])

  const handleOpenEdit = useCallback(() => {
    if (!detail) return
    setEditConsumeMode(detail.consumeMode ?? ConsumeMode.ModeClustering)
    setEditMaxRetry(detail.maxRetry ?? 16)
    setEditError(null)
    setEditOpen(true)
  }, [detail])

  const handleEditSubmit = useCallback(async () => {
    if (!selectedGroup) return
    setEditSubmitting(true)
    setEditError(null)
    try {
      await consumerApi.updateConsumerGroup(selectedGroup, '', editConsumeMode, editMaxRetry)
      toast.success('消费者组配置已更新')
      setEditOpen(false)
      void loadDetail(selectedGroup)
      onRefresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    } finally {
      setEditSubmitting(false)
    }
  }, [selectedGroup, editConsumeMode, editMaxRetry, loadDetail, onRefresh])

  const handleResetOffset = useCallback(async () => {
    if (!selectedGroup) {
      toast.error('未选择消费者组')
      return
    }
    if (!resetTopic.trim()) {
      toast.error('请选择或输入 Topic')
      return
    }

    const timestamp = new Date(resetTimestamp).getTime()
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      toast.error('请输入有效的重置时间')
      return
    }

    setResetSubmitting(true)
    try {
      await consumerApi.resetOffset(selectedGroup, resetTopic.trim(), timestamp, resetForce)
      toast.success('位点已重置')
      setResetDialogOpen(false)
      await Promise.resolve(onRefresh())
      await loadDetail(selectedGroup)
      await loadStats(selectedGroup)
    } catch (err) {
      toast.error(formatErrorMessage(err))
    } finally {
      setResetSubmitting(false)
    }
  }, [loadDetail, loadStats, onRefresh, resetForce, resetTimestamp, resetTopic, selectedGroup])

  const handleDeleteConfirm = useCallback(
    async (groupName: string) => {
      setDeletingGroup(groupName)
      try {
        await consumerApi.deleteConsumerGroup(groupName, '')
        toast.success('已删除')
        setDeleteConfirmGroup(null)
        if (selectedGroup === groupName) setSelectedGroup(null)
        onRefresh()
      } catch (err) {
        toast.error(formatErrorMessage(err))
      } finally {
        setDeletingGroup(null)
      }
    },
    [onRefresh, selectedGroup]
  )

  const statusLabel = (status: GroupStatus) => {
    switch (status) {
      case GroupStatus.GroupOnline:
        return '在线'
      case GroupStatus.GroupWarning:
        return '告警'
      case GroupStatus.GroupOffline:
        return '离线'
      default:
        return '—'
    }
  }

  const consumeModeLabel = (mode: ConsumeMode) => {
    switch (mode) {
      case ConsumeMode.ModeClustering:
        return '集群'
      case ConsumeMode.ModeBroadcasting:
        return '广播'
      default:
        return '—'
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border/40 px-5 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold text-foreground">消费者组</h1>
          <div className="relative">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isSpinning}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50'
              )}
              aria-label="刷新"
            >
              <RefreshCw className={cn('h-4 w-4', isSpinning && 'animate-spin')} />
            </button>
            {showTooltip && (
              <span
                className="absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border/50 bg-card px-2 py-1.5 text-xs text-card-foreground shadow-sm"
                role="tooltip"
              >
                刷新
              </span>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索消费者组…"
            className="w-full rounded-md border border-border/40 bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            aria-label="搜索消费者组"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto scroll-thin p-4">
          {loading && list.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">加载中…</div>
          ) : error ? (
            <div className="rounded-md border border-border/50 bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              {error}
            </div>
          ) : filteredList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim() ? '无匹配消费者组' : '暂无消费者组'}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredList.map((g) => (
                <li
                  key={g.group ?? ''}
                  onClick={() => setSelectedGroup(g.group ?? null)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between rounded-md border border-border/40 px-3 py-2 transition-colors hover:border-primary/50 hover:bg-accent/50',
                    selectedGroup === (g.group ?? '') && 'border-primary/50 bg-accent/50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">{g.group}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5',
                          g.status === GroupStatus.GroupOnline && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                          g.status === GroupStatus.GroupWarning && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                          (g.status === GroupStatus.GroupOffline || !g.status) && 'bg-muted/80'
                        )}
                      >
                        {statusLabel(g.status)}
                      </span>
                      <span>{consumeModeLabel(g.consumeMode)}</span>
                      <span>在线 {g.onlineClients ?? 0}</span>
                      <span>Topic {g.topicCount ?? 0}</span>
                      {(g.lag ?? 0) > 0 && <span>堆积 {g.lag}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirmGroup(g.group ?? '')
                    }}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="删除"
                    aria-label="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selectedGroup && (
          <div className="flex w-[clamp(280px,32vw,380px)] shrink-0 flex-col border-l border-border/40 bg-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-2.5">
              <span className="truncate text-sm font-medium text-foreground">消费者组详情</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleOpenEdit}
                  disabled={detailLoading || detail == null}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  aria-label="编辑配置"
                  title="编辑配置"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleOpenResetDialog}
                  disabled={detailLoading || detail == null}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  aria-label="重置位点"
                  title="重置位点"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedGroup(null)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin p-3">
              {detailLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : detailError ? (
                <p className="text-sm text-destructive">{detailError}</p>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-border/40 bg-background/60 p-3">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      <span>消费统计</span>
                    </div>
                    {statsLoading ? (
                      <div className="flex items-center justify-center py-4 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : statsError ? (
                      <p className="text-xs text-destructive">{statsError}</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md border border-border/40 bg-card px-3 py-2">
                          <div className="text-[11px] text-muted-foreground">消费 TPS</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{stats?.consumeTps ?? 0}</div>
                        </div>
                        <div className="rounded-md border border-border/40 bg-card px-3 py-2">
                          <div className="text-[11px] text-muted-foreground">总堆积</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{stats?.diffTotal ?? 0}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <p>
                      <span className="text-muted-foreground">名称：</span>
                      <span className="font-mono text-foreground">{detail.group}</span>
                    </p>
                    {detail.cluster != null && detail.cluster !== '' && (
                      <p>
                        <span className="text-muted-foreground">集群：</span>
                        <span className="text-foreground">{detail.cluster}</span>
                      </p>
                    )}
                    <p>
                      <span className="text-muted-foreground">状态 / 模式：</span>
                      <span className="text-foreground">{statusLabel(detail.status)} / {consumeModeLabel(detail.consumeMode)}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">在线客户端：</span>
                      <span className="text-foreground">{detail.onlineClients ?? 0}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">订阅 Topic 数：</span>
                      <span className="text-foreground">{detail.topicCount ?? 0}</span>
                    </p>
                    {(detail.maxRetry ?? 0) > 0 && (
                      <p>
                        <span className="text-muted-foreground">最大重试：</span>
                        <span className="text-foreground">{detail.maxRetry}</span>
                      </p>
                    )}
                  </div>
                  {detail.subscriptions != null && detail.subscriptions.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium text-muted-foreground">订阅关系</h3>
                      <ul className="space-y-1 rounded-md border border-border/40 py-2">
                        {detail.subscriptions.map((sub, i) => (
                          <li key={i} className="flex items-center justify-between px-3 text-xs">
                            <span className="font-mono text-foreground">{sub.topic ?? '-'}</span>
                            {sub.expression != null && sub.expression !== '' && (
                              <span className="text-muted-foreground">{sub.expression}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {detail.clients != null && detail.clients.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium text-muted-foreground">客户端</h3>
                      <div className="overflow-x-auto rounded-md border border-border/40">
                        <table className="w-full min-w-[240px] text-xs">
                          <thead>
                            <tr className="border-b border-border/40 bg-muted/30">
                              <th className="px-2 py-1.5 text-left font-medium text-foreground">ClientID</th>
                              <th className="px-2 py-1.5 text-left font-medium text-foreground">IP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.clients.map((c, i) => (
                              <tr key={i} className="border-b border-border/30 last:border-0">
                                <td className="max-w-[140px] truncate px-2 py-1.5 font-mono text-foreground" title={c.clientId ?? ''}>
                                  {c.clientId ?? '-'}
                                </td>
                                <td className="px-2 py-1.5 font-mono text-muted-foreground">{c.ip ?? '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {editOpen && selectedGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !editSubmitting && setEditOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-consumer-title"
        >
          <div
            className="w-full max-w-md rounded-md border border-border/50 bg-card p-4 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="edit-consumer-title" className="text-sm font-medium text-card-foreground">
              编辑消费者组配置
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              修改「<span className="font-mono text-foreground">{selectedGroup}</span>」的消费模式和重试次数
            </p>
            {editError && (
              <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label id="edit-consumer-mode-label" className="mb-1 block text-xs text-muted-foreground">消费模式</label>
                <select
                  value={editConsumeMode}
                  onChange={(e) => setEditConsumeMode(e.target.value)}
                  aria-labelledby="edit-consumer-mode-label"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {CONSUME_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label id="edit-consumer-retry-label" className="mb-1 block text-xs text-muted-foreground">最大重试次数</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editMaxRetry}
                  onChange={(e) => setEditMaxRetry(Number(e.target.value) || 0)}
                  onBlur={() => setEditMaxRetry(Math.max(0, Math.min(100, editMaxRetry)))}
                  aria-labelledby="edit-consumer-retry-label"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                disabled={editSubmitting}
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleEditSubmit()}
                disabled={editSubmitting}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {editSubmitting ? (
                  <>
                    <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" aria-hidden />
                    保存中…
                  </>
                ) : (
                  '保存'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => deletingGroup === null && setDeleteConfirmGroup(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-consumer-title"
        >
          <div
            className="w-full max-w-sm rounded-md border border-border/50 bg-card p-4 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="delete-consumer-title" className="text-sm font-medium text-card-foreground">
                  删除消费者组
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  确定删除消费者组「<span className="font-mono text-foreground">{deleteConfirmGroup}</span>」？此操作不可恢复。
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmGroup(null)}
                disabled={deletingGroup !== null}
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfirm(deleteConfirmGroup)}
                disabled={deletingGroup !== null}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deletingGroup === deleteConfirmGroup ? (
                  <>
                    <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" aria-hidden />
                    删除中…
                  </>
                ) : (
                  '确定删除'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetDialogOpen && selectedGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => resetSubmitting === false && setResetDialogOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-offset-title"
        >
          <div
            className="w-full max-w-md rounded-md border border-border/50 bg-card p-4 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                <RotateCcw className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="reset-offset-title" className="text-sm font-medium text-card-foreground">
                  重置消费位点
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  为消费者组「<span className="font-mono text-foreground">{selectedGroup}</span>」按时间重置位点。
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="reset-topic" className="text-xs font-medium text-muted-foreground">
                  Topic
                </label>
                {detail?.subscriptions != null && detail.subscriptions.length > 0 ? (
                  <select
                    id="reset-topic"
                    value={resetTopic}
                    onChange={(e) => setResetTopic(e.target.value)}
                    className="w-full rounded-md border border-border/40 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50"
                  >
                    <option value="">请选择 Topic</option>
                    {detail.subscriptions.map((sub, index) => (
                      <option key={`${sub.topic ?? 'topic'}-${index}`} value={sub.topic ?? ''}>
                        {sub.topic ?? '-'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="reset-topic"
                    type="text"
                    value={resetTopic}
                    onChange={(e) => setResetTopic(e.target.value)}
                    placeholder="输入 Topic 名称"
                    className="w-full rounded-md border border-border/40 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="reset-timestamp" className="text-xs font-medium text-muted-foreground">
                  重置时间
                </label>
                <input
                  id="reset-timestamp"
                  type="datetime-local"
                  value={resetTimestamp}
                  onChange={(e) => setResetTimestamp(e.target.value)}
                  className="w-full rounded-md border border-border/40 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              <label className="flex items-center gap-2 rounded-md border border-border/40 bg-background/60 px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={resetForce}
                  onChange={(e) => setResetForce(e.target.checked)}
                  className="h-4 w-4 rounded border-border/60"
                />
                <span>强制重置</span>
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetDialogOpen(false)}
                disabled={resetSubmitting}
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleResetOffset()}
                disabled={resetSubmitting}
                className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {resetSubmitting ? (
                  <>
                    <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" aria-hidden />
                    提交中…
                  </>
                ) : (
                  '确认重置'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
