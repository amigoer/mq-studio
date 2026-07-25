import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * The one empty state. Pages used to render five different ones — an icon with
 * a call to action, a bare centred sentence, a Card, and in one case the word
 * "Search" followed by an arrow — so "nothing here" looked like a different
 * kind of event on every screen.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  compact,
  className,
  children,
}: {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  actionLabel?: string
  onAction?: () => void
  /** For empties nested inside a card or detail panel, where the page-sized one would dwarf its container. */
  compact?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center text-muted-foreground',
        compact ? 'p-4' : 'min-h-[15rem] p-10',
        className,
      )}
    >
      {Icon && !compact && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border">
          <Icon size={18} className="opacity-50" aria-hidden />
        </div>
      )}
      <div className={compact ? 'text-fs-12' : 'text-fs-13 font-medium text-foreground/80'}>
        {title}
      </div>
      {description && <div className="mt-1 max-w-sm text-fs-115 leading-snug">{description}</div>}
      {onAction && actionLabel && (
        <Button variant="default" size="sm" type="button" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
      {children}
    </div>
  )
}
