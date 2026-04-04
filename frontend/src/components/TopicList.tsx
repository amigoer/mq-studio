import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Plus, Search, X, Trash2, Loader2, AlertTriangle, BarChart3, Pencil, ChevronDown, Filter, Eye, EyeOff } from 'lucide-react'
import { cn, formatErrorMessage } from '@/lib/utils'
import type { TopicItem } from '../../bindings/rocket-leaf/internal/model/models.js'
import { TopicPerm } from '../../bindings/rocket-leaf/internal/model/models.js'
import * as topicApi from '@/api/topic'
import * as clusterApi from '@/api/cluster'

const TOOLTIP_DELAY_MS = 150
const MIN_SPIN_MS = 400

type QueueStat = {
  brokerName: string
  queueId: number
  minOffset: number
  maxOffset: number
  messages: number
  lastUpdate: number
}

type TopicStats = {
  queueCount: number
  totalMinOffset: number
  totalMaxOffset: number
  totalMessages: number
  queues: QueueStat[]
}

function parseTopicStats(data: Record<string, unknown>): TopicStats {
  const rawQueues = Array.isArray(data.queues) ? data.queues : []
  return {
    queueCount: typeof data.queueCount === 'number' ? data.queueCount : 0,
    totalMinOffset: typeof data.totalMinOffset === 'number' ? data.totalMinOffset : 0,
    totalMaxOffset: typeof data.totalMaxOffset === 'number' ? data.totalMaxOffset : 0,
    totalMessages: typeof data.totalMessages === 'number' ? data.totalMessages : 0,
    queues: rawQueues.map((q: Record<string, unknown>) => ({
      brokerName: typeof q.brokerName === 'string' ? q.brokerName : '',
      queueId: typeof q.queueId === 'number' ? q.queueId : 0,
      minOffset: typeof q.minOffset === 'number' ? q.minOffset : 0,
      maxOffset: typeof q.maxOffset === 'number' ? q.maxOffset : 0,
      messages: typeof q.messages === 'number' ? q.messages : 0,
      lastUpdate: typeof q.lastUpdate === 'number' ? q.lastUpdate : 0,
    })),
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

type Props = {
  list: TopicItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

const PERM_OPTIONS: { value: TopicPerm; label: string }[] = [
  { value: TopicPerm.PermRW, label: '读写 (RW)' },
  { value: TopicPerm.PermR, label: '只读 (R)' },
  { value: TopicPerm.PermW, label: '只写 (W)' },
  { value: TopicPerm.PermDeny, label: '拒绝 (DENY)' },
]

export function TopicList({ list, loading, error, onRefresh }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [clusterFilter, setClusterFilter] = useState<string>('')
  const [showSystem, setShowSystem] = useState(false)
  const [systemTopics, setSystemTopics] = useState<TopicItem[]>([])
  const [systemLoading, setSystemLoading] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [detail, setDetail] = useState<TopicItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [brokerOptions, setBrokerOptions] = useState<string[]>([])
  const [brokerOptionsLoading, setBrokerOptionsLoading] = useState(false)
  const [stats, setStats] = useState<TopicStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [queueDetailExpanded, setQueueDetailExpanded] = useState(false)
  const [deleteConfirmTopic, setDeleteConfirmTopic] = useState<string | null>(null)
  const [deletingTopic, setDeletingTopic] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editReadQueue, setEditReadQueue] = useState(4)
  const [editWriteQueue, setEditWriteQueue] = useState(4)
  const [editPerm, setEditPerm] = useState<string>(TopicPerm.PermRW)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spinEndRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSpinning = loading || refreshing

  // 切换系统 Topic 时加载
  useEffect(() => {
    if (!showSystem) { setSystemTopics([]); return }
    let cancelled = false
    setSystemLoading(true)
    topicApi.getAllTopics()
      .then((data) => {
        if (cancelled) return
        const all = data.filter((t): t is TopicItem => t != null)
        // 仅保留系统 Topic（不在 list 中的）
        const userTopicSet = new Set(list.map((t) => t.topic ?? ''))
        setSystemTopics(all.filter((t) => !userTopicSet.has(t.topic ?? '')))
      })
      .catch(() => { if (!cancelled) setSystemTopics([]) })
      .finally(() => { if (!cancelled) setSystemLoading(false) })
    return () => { cancelled = true }
  }, [showSystem, list])

  const combinedList = showSystem ? [...list, ...systemTopics] : list
  const clusterNames = Array.from(new Set(combinedList.map((t) => t.cluster ?? '').filter(Boolean))).sort()

  const filteredList = combinedList.filter((t) => {
    if (clusterFilter && (t.cluster ?? '') !== clusterFilter) return false
    if (searchQuery.trim() && !(t.topic ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase())) return false
    return true
  })

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

  useEffect(() => {
    if (!selectedTopic) {
      setDetail(null)
      setDetailError(null)
      setStats(null)
      setQueueDetailExpanded(false)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    setStatsLoading(true)
    topicApi
      .getTopicDetail(selectedTopic)
      .then((data) => {
        if (!cancelled) {
          setDetail(data ?? null)
          setDetailError(data ? null : '未获取到详情')
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDetailError(formatErrorMessage(e))
          setDetail(null)
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    topicApi
      .getTopicStats(selectedTopic)
      .then((data) => {
        if (!cancelled) setStats(parseTopicStats(data))
      })
      .catch(() => {
        if (!cancelled) setStats(null)
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedTopic])

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
    onRefresh()
  }, [onRefresh])

  useEffect(() => {
    if (!createOpen) return
    let cancelled = false
    setBrokerOptionsLoading(true)
    clusterApi.getBrokers()
      .then((brokers) => {
        if (cancelled) return
        const options = brokers
          .filter((b): b is NonNullable<typeof b> => b != null && (b.address ?? '').trim() !== '')
          .map((b) => b.address!.trim())
        setBrokerOptions(Array.from(new Set(options)))
      })
      .catch(() => {
        if (!cancelled) setBrokerOptions([])
      })
      .finally(() => {
        if (!cancelled) setBrokerOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [createOpen])

  const handleCreateSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const form = e.currentTarget
      const topic = (form.querySelector('[name="topic"]') as HTMLInputElement)?.value?.trim()
      const brokerAddr = (form.querySelector('[name="brokerAddr"]') as HTMLInputElement)?.value?.trim()
      const readQueue = Number((form.querySelector('[name="readQueue"]') as HTMLInputElement)?.value) || 4
      const writeQueue = Number((form.querySelector('[name="writeQueue"]') as HTMLInputElement)?.value) || 4
      const perm = (form.querySelector('[name="perm"]') as HTMLSelectElement)?.value ?? TopicPerm.PermRW
      if (!topic) {
        setCreateError('请输入 Topic 名称')
        return
      }
      if (!brokerAddr) {
        setCreateError('请输入 Broker 地址')
        return
      }
      setCreateSubmitting(true)
      setCreateError(null)
      try {
        await topicApi.createTopic(topic, brokerAddr, readQueue, writeQueue, perm)
        toast.success('创建成功')
        setCreateOpen(false)
        onRefresh()
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : String(err))
      } finally {
        setCreateSubmitting(false)
      }
    },
    [onRefresh]
  )

  const handleOpenEdit = useCallback(() => {
    if (!detail) return
    setEditReadQueue(detail.readQueue ?? 4)
    setEditWriteQueue(detail.writeQueue ?? 4)
    setEditPerm(detail.perm ?? TopicPerm.PermRW)
    setEditError(null)
    setEditOpen(true)
  }, [detail])

  const handleEditSubmit = useCallback(async () => {
    if (!detail || !detail.topic) return
    // Need a broker address to update; use the first route's brokerAddr
    const brokerAddr = detail.routes?.[0]?.brokerAddr
    if (!brokerAddr) {
      setEditError('未找到 Broker 地址，无法更新')
      return
    }
    setEditSubmitting(true)
    setEditError(null)
    try {
      await topicApi.updateTopic(detail.topic, brokerAddr, editReadQueue, editWriteQueue, editPerm)
      toast.success('Topic 配置已更新')
      setEditOpen(false)
      // Refresh detail
      setDetailLoading(true)
      const updated = await topicApi.getTopicDetail(detail.topic)
      setDetail(updated ?? null)
      setDetailLoading(false)
      onRefresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    } finally {
      setEditSubmitting(false)
    }
  }, [detail, editReadQueue, editWriteQueue, editPerm, onRefresh])

  const handleDeleteConfirm = useCallback(
    async (topic: string) => {
      setDeletingTopic(topic)
      try {
        const detail = await topicApi.getTopicDetail(topic)
        await topicApi.deleteTopic(topic, detail?.cluster ?? '')
        toast.success('已删除')
        setDeleteConfirmTopic(null)
        if (selectedTopic === topic) setSelectedTopic(null)
        onRefresh()
      } catch (err) {
        toast.error(formatErrorMessage(err))
      } finally {
        setDeletingTopic(null)
      }
    },
    [onRefresh, selectedTopic]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border/40 px-5 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold text-foreground">主题</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowSystem(!showSystem)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                showSystem ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              aria-label={showSystem ? '隐藏系统 Topic' : '显示系统 Topic'}
              title={showSystem ? '隐藏系统 Topic' : '显示系统 Topic'}
            >
              {systemLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : showSystem ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateError(null)
                setCreateOpen(true)
              }}
              className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              创建 Topic
            </button>
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
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Topic…"
              className="w-full rounded-md border border-border/40 bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              aria-label="搜索 Topic"
            />
          </div>
          {clusterNames.length > 1 && (
            <div className="relative shrink-0">
              <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <select
                value={clusterFilter}
                onChange={(e) => setClusterFilter(e.target.value)}
                className={cn(
                  'appearance-none rounded-md border border-border/40 bg-background py-1.5 pl-7 pr-6 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50',
                  clusterFilter ? 'text-foreground' : 'text-muted-foreground'
                )}
                aria-label="按集群筛选"
              >
                <option value="">全部集群</option>
                {clusterNames.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
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
              {searchQuery.trim() ? '无匹配 Topic' : '暂无主题'}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredList.map((t) => (
                <li
                  key={t.topic ?? ''}
                  onClick={() => setSelectedTopic(t.topic ?? null)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between rounded-md border border-border/40 px-3 py-2 transition-colors hover:border-primary/50 hover:bg-accent/50',
                    selectedTopic === (t.topic ?? '') && 'border-primary/50 bg-accent/50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground truncate">{t.topic}</span>
                      {(t.description === '系统') && (
                        <span className="shrink-0 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">系统</span>
                      )}
                    </div>
                    {(t.readQueue ?? -1) >= 0 && (t.writeQueue ?? -1) >= 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        读 {t.readQueue} / 写 {t.writeQueue}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">
                        队列信息见详情
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirmTopic(t.topic ?? '')
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

        {selectedTopic && (
          <div className="flex w-[clamp(280px,32vw,380px)] shrink-0 flex-col border-l border-border/40 bg-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-2.5">
              <span className="truncate text-sm font-medium text-foreground">Topic 详情</span>
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
                  onClick={() => setSelectedTopic(null)}
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
                  <div className="space-y-1.5 text-sm">
                    <p>
                      <span className="text-muted-foreground">名称：</span>
                      <span className="font-mono text-foreground">{detail.topic}</span>
                    </p>
                    {detail.cluster != null && detail.cluster !== '' && (
                      <p>
                        <span className="text-muted-foreground">集群：</span>
                        <span className="text-foreground">{detail.cluster}</span>
                      </p>
                    )}
                    <p>
                      <span className="text-muted-foreground">读队列 / 写队列：</span>
                      <span className="text-foreground">{detail.readQueue ?? 0} / {detail.writeQueue ?? 0}</span>
                    </p>
                    {detail.perm != null && detail.perm !== '' && (
                      <p>
                        <span className="text-muted-foreground">权限：</span>
                        <span className="text-foreground">{detail.perm}</span>
                      </p>
                    )}
                  </div>
                  {/* 统计信息 */}
                  <div className="rounded-md border border-border/40 bg-background/60 p-3">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      <span>统计</span>
                    </div>
                    {statsLoading ? (
                      <div className="flex items-center justify-center py-4 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : stats ? (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-md border border-border/40 bg-card px-3 py-2">
                            <div className="text-[11px] text-muted-foreground">消息队列</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{stats.queueCount}</div>
                          </div>
                          <div className="rounded-md border border-border/40 bg-card px-3 py-2">
                            <div className="text-[11px] text-muted-foreground">最大偏移</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{formatNumber(stats.totalMaxOffset)}</div>
                          </div>
                          <div className="rounded-md border border-border/40 bg-card px-3 py-2">
                            <div className="text-[11px] text-muted-foreground">消息总量</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{formatNumber(stats.totalMessages)}</div>
                          </div>
                        </div>
                        {stats.queues.length > 0 && (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => setQueueDetailExpanded(!queueDetailExpanded)}
                              className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <span>队列明细</span>
                              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', queueDetailExpanded && 'rotate-180')} />
                            </button>
                            {queueDetailExpanded && (
                              <div className="mt-2 overflow-x-auto rounded-md border border-border/40">
                                <table className="w-full min-w-[320px] text-xs">
                                  <thead>
                                    <tr className="border-b border-border/40 bg-muted/30">
                                      <th className="px-2 py-1.5 text-left font-medium text-foreground">Broker</th>
                                      <th className="px-2 py-1.5 text-right font-medium text-foreground">QueueID</th>
                                      <th className="px-2 py-1.5 text-right font-medium text-foreground">Min</th>
                                      <th className="px-2 py-1.5 text-right font-medium text-foreground">Max</th>
                                      <th className="px-2 py-1.5 text-right font-medium text-foreground">消息量</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stats.queues.map((q, i) => (
                                      <tr key={i} className="border-b border-border/30 last:border-0">
                                        <td className="px-2 py-1.5 font-mono text-foreground">{q.brokerName}</td>
                                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{q.queueId}</td>
                                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{formatNumber(q.minOffset)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{formatNumber(q.maxOffset)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono text-foreground">{formatNumber(q.messages)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">暂无统计数据</p>
                    )}
                  </div>
                  {detail.routes != null && detail.routes.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-medium text-muted-foreground">路由</h3>
                      <div className="overflow-x-auto rounded-md border border-border/40">
                        <table className="w-full min-w-[280px] text-xs">
                          <thead>
                            <tr className="border-b border-border/40 bg-muted/30">
                              <th className="px-2 py-1.5 text-left font-medium text-foreground">Broker</th>
                              <th className="px-2 py-1.5 text-left font-medium text-foreground">地址</th>
                              <th className="px-2 py-1.5 text-right font-medium text-foreground">读/写</th>
                              <th className="px-2 py-1.5 text-left font-medium text-foreground">权限</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.routes.map((r, i) => (
                              <tr key={i} className="border-b border-border/30 last:border-0">
                                <td className="px-2 py-1.5 font-mono text-foreground">{r.broker ?? '-'}</td>
                                <td className="max-w-[120px] truncate px-2 py-1.5 font-mono text-muted-foreground" title={r.brokerAddr ?? ''}>
                                  {r.brokerAddr ?? '-'}
                                </td>
                                <td className="px-2 py-1.5 text-right text-muted-foreground">
                                  {r.readQueue ?? 0} / {r.writeQueue ?? 0}
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground">{r.perm ?? '-'}</td>
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

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-md border border-border/50 bg-card p-4">
            <h2 className="text-sm font-medium text-card-foreground">创建 Topic</h2>
            {createError && (
              <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createError}
              </div>
            )}
            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3">
              <div>
                <label id="create-topic-name-label" className="mb-1 block text-xs text-muted-foreground">Topic 名称</label>
                <input
                  id="create-topic-name"
                  name="topic"
                  type="text"
                  aria-labelledby="create-topic-name-label"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="例如：my_topic"
                />
              </div>
              <div>
                <label
                  id="create-topic-broker-label"
                  htmlFor={brokerOptions.length > 0 ? 'create-topic-broker-select' : 'create-topic-broker-input'}
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  Broker 地址
                </label>
                {brokerOptions.length > 0 ? (
                  <select
                    id="create-topic-broker-select"
                    name="brokerAddr"
                    aria-labelledby="create-topic-broker-label"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                    defaultValue={brokerOptions[0]}
                  >
                    {brokerOptions.map((addr) => (
                      <option key={addr} value={addr}>
                        {addr}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="create-topic-broker-input"
                    name="brokerAddr"
                    type="text"
                    aria-labelledby="create-topic-broker-label"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                    placeholder={brokerOptionsLoading ? '正在加载 Broker…' : '例如：192.168.1.1:10911'}
                  />
                )}
                {brokerOptionsLoading && (
                  <p className="mt-1 text-xs text-muted-foreground">正在加载可用 Broker 地址…</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label id="create-topic-read-label" className="mb-1 block text-xs text-muted-foreground">读队列数</label>
                  <input
                    id="create-topic-read"
                    name="readQueue"
                    type="number"
                    min={1}
                    defaultValue={4}
                    aria-labelledby="create-topic-read-label"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label id="create-topic-write-label" className="mb-1 block text-xs text-muted-foreground">写队列数</label>
                  <input
                    id="create-topic-write"
                    name="writeQueue"
                    type="number"
                    min={1}
                    defaultValue={4}
                    aria-labelledby="create-topic-write-label"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label id="create-topic-perm-label" className="mb-1 block text-xs text-muted-foreground">权限</label>
                <select
                  id="create-topic-perm"
                  name="perm"
                  aria-labelledby="create-topic-perm-label"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue={TopicPerm.PermRW}
                >
                  {PERM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-border/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {createSubmitting ? '创建中…' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !editSubmitting && setEditOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-topic-title"
        >
          <div
            className="w-full max-w-md rounded-md border border-border/50 bg-card p-4 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="edit-topic-title" className="text-sm font-medium text-card-foreground">
              编辑 Topic 配置
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              修改「<span className="font-mono text-foreground">{detail.topic}</span>」的队列数和权限
            </p>
            {editError && (
              <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label id="edit-topic-read-label" className="mb-1 block text-xs text-muted-foreground">读队列数</label>
                  <input
                    type="number"
                    min={1}
                    value={editReadQueue}
                    onChange={(e) => setEditReadQueue(Number(e.target.value) || 1)}
                    aria-labelledby="edit-topic-read-label"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label id="edit-topic-write-label" className="mb-1 block text-xs text-muted-foreground">写队列数</label>
                  <input
                    type="number"
                    min={1}
                    value={editWriteQueue}
                    onChange={(e) => setEditWriteQueue(Number(e.target.value) || 1)}
                    aria-labelledby="edit-topic-write-label"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label id="edit-topic-perm-label" className="mb-1 block text-xs text-muted-foreground">权限</label>
                <select
                  value={editPerm}
                  onChange={(e) => setEditPerm(e.target.value)}
                  aria-labelledby="edit-topic-perm-label"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {PERM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
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

      {deleteConfirmTopic && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => deletingTopic === null && setDeleteConfirmTopic(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-topic-title"
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
                <h2 id="delete-topic-title" className="text-sm font-medium text-card-foreground">
                  删除 Topic
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  确定删除 Topic「<span className="font-mono text-foreground">{deleteConfirmTopic}</span>」？此操作不可恢复。
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmTopic(null)}
                disabled={deletingTopic !== null}
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfirm(deleteConfirmTopic)}
                disabled={deletingTopic !== null}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deletingTopic === deleteConfirmTopic ? (
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
    </div>
  )
}
