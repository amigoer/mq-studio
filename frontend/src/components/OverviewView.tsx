import { useState, useEffect } from 'react'
import { LayoutGrid, Users, Mail, BarChart3, Server, CircleDot, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Connection, ClusterSummary } from '../../bindings/rocket-leaf/internal/model/models.js'
import { ConnectionStatus } from '../../bindings/rocket-leaf/internal/model/models.js'
import type { NavId } from './IconSidebar'
import * as clusterApi from '@/api/cluster'

type Props = {
  connections: Connection[]
  topicCount: number
  consumerGroupCount?: number
  onSelectNav: (id: NavId) => void
}

const SHORTCUTS: { id: NavId; icon: React.ElementType; label: string; description: string }[] = [
  { id: 'topics', icon: LayoutGrid, label: '主题', description: 'Topic 列表与路由' },
  { id: 'consumers', icon: Users, label: '消费者组', description: '消费组与进度' },
  { id: 'messages', icon: Mail, label: '消息', description: '查询与发送' },
  { id: 'cluster', icon: BarChart3, label: '集群', description: '状态与 TPS' },
]

export function OverviewView({ connections, topicCount, consumerGroupCount = 0, onSelectNav }: Props) {
  const currentConn = connections.find((c) => c.status === ConnectionStatus.StatusOnline)
  const defaultConn = connections.find((c) => c.isDefault)
  const [summary, setSummary] = useState<ClusterSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    clusterApi.getClusterSummary().then((data) => {
      if (!cancelled) setSummary(data)
    }).catch(() => {
      if (!cancelled) setSummary(null)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border/40 px-5 py-3.5">
        <h1 className="text-sm font-semibold text-foreground">概览</h1>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-5">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* 当前连接 */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">当前连接</h2>
            <div className="rounded-lg border border-border/40 bg-card p-5 shadow-sm">
              {currentConn ? (
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Server className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{currentConn.name}</span>
                      <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <CircleDot className="h-3 w-3" />
                        已连接
                      </span>
                      {currentConn.env != null && String(currentConn.env).trim() !== '' && (
                        <span className="rounded bg-muted/80 px-1.5 py-0.5 text-xs text-muted-foreground">
                          {currentConn.env}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm text-muted-foreground">{currentConn.nameServer}</p>
                  </div>
                </div>
              ) : defaultConn ? (
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
                    <Server className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{defaultConn.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">未连接，请至连接管理连接集群</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无连接配置</p>
              )}
            </div>
          </section>

          {/* 数据概览 */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">数据概览</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => onSelectNav('topics')}
                className="rounded-lg border border-border/40 bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/50"
              >
                <p className="text-2xl font-semibold tabular-nums text-foreground">{topicCount}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Topic</p>
              </button>
              <button
                type="button"
                onClick={() => onSelectNav('consumers')}
                className="rounded-lg border border-border/40 bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/50"
              >
                <p className="text-2xl font-semibold tabular-nums text-foreground">{consumerGroupCount}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">消费者组</p>
              </button>
              <button
                type="button"
                onClick={() => onSelectNav('cluster')}
                className="rounded-lg border border-border/40 bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/50"
              >
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {summary ? `${summary.onlineBrokers}/${summary.totalBrokers}` : '—'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Broker</p>
                <p className="mt-1 text-[10px] text-muted-foreground/80">在线 / 总数</p>
              </button>
              <button
                type="button"
                onClick={() => onSelectNav('cluster')}
                className="rounded-lg border border-border/40 bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/50"
              >
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    {summary ? `${summary.avgDiskUsage}%` : '—'}
                  </p>
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">磁盘使用</p>
                <p className="mt-1 text-[10px] text-muted-foreground/80">集群平均</p>
              </button>
            </div>
          </section>

          {/* 快捷入口 */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">快捷入口</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {SHORTCUTS.map(({ id, icon: Icon, label, description }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectNav(id)}
                  className={cn(
                    'flex flex-col items-start gap-3 rounded-lg border border-border/40 bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/50'
                  )}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
