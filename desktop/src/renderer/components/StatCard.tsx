import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A single headline metric on a card: label + optional icon, the value, then
 * either a hint line or arbitrary content underneath.
 *
 * Overview, Cluster and the topic detail panel each carried their own copy of
 * this markup, which is why the same card had three different value sizes and
 * two different top margins.
 */
export function StatCard({
  label,
  icon: Icon,
  iconColor,
  value,
  valueColor,
  valueClassName,
  hint,
  children,
  className,
}: {
  label: ReactNode
  icon?: LucideIcon
  iconColor?: string
  value: ReactNode
  valueColor?: string
  valueClassName?: string
  hint?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        // No hover lift: these cards are not clickable, and the lift read as a
        // promise that they were.
        'rounded-xl border border-border/80 bg-card p-3.5 shadow-card',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-fs-115 text-muted-foreground">{label}</span>
        {Icon && (
          <Icon
            size={13}
            className={iconColor ? undefined : 'text-muted-foreground opacity-70'}
            style={iconColor ? { color: iconColor } : undefined}
          />
        )}
      </div>
      <div
        className={cn(
          'mt-1 text-fs-21 font-semibold leading-tight tracking-[-0.02em] tabular-nums',
          valueClassName,
        )}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-fs-11 leading-snug text-muted-foreground">{hint}</div>}
      {children}
    </div>
  )
}
