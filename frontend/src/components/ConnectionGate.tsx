import { Plus, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  onAddConnection: () => void
  hasConnections: boolean
}

export function ConnectionGate({ onAddConnection, hasConnections }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex h-18 w-18 items-center justify-center rounded-2xl border border-border/40 bg-muted/40 shadow-sm">
        <WifiOff className="h-8 w-8 text-muted-foreground/70" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">
          {hasConnections ? '请先连接集群' : '暂无连接配置'}
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {hasConnections
            ? '在左侧选择「连接管理」添加或选择连接，然后点击连接。'
            : '点击下方按钮添加 NameServer 连接配置。'}
        </p>
      </div>
      <button
        type="button"
        onClick={onAddConnection}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-border/50 bg-background px-5 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent'
        )}
      >
        <Plus className="h-4 w-4" />
        {hasConnections ? '连接管理' : '添加连接'}
      </button>
    </div>
  )
}
