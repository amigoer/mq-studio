import { PlugZap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function OfflineEmpty({
  message,
  actionLabel,
  onAction,
  className,
}: {
  message?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'rl-muted flex min-h-[240px] flex-col items-center justify-center p-10 text-center',
        className,
      )}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border">
        <PlugZap size={18} className="opacity-50" />
      </div>
      <div className="text-[13px] font-medium text-foreground/80">
        {message ?? t('common.connectFirst')}
      </div>
      {onAction && actionLabel && (
        <button className="rl-btn rl-btn-primary rl-btn-sm mt-4" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
