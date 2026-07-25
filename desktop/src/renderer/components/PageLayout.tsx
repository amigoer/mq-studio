import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Content width buckets. Ten pages previously picked from six different
 * maximum widths (1024, 1020, 1280, 960, 860, 720, 512) with no rule behind
 * the choice; these are the three that were actually meaningful, plus `full`
 * for the table pages that should use everything they are given.
 *
 * In rem, so a larger font size widens the column with the text.
 */
const WIDTHS = {
  /** Single-column forms. */
  form: 'mx-auto w-full max-w-[39rem]',
  /** Settings and other prose-ish, row-per-setting screens. */
  content: 'mx-auto w-full max-w-[56rem]',
  /** Dashboards and multi-column layouts. */
  wide: 'mx-auto w-full max-w-[76rem]',
  /** Tables and split views: use the whole pane. */
  full: 'w-full',
} as const

/**
 * Scrolling body of a page, below the header and any toolbar.
 *
 * Owns the page's inset so every screen shares one horizontal rhythm — and,
 * importantly, the same inset as PageHeader, which the toolbars did not.
 */
export function PageBody({
  width = 'full',
  className,
  innerClassName,
  onClick,
  children,
}: {
  width?: keyof typeof WIDTHS
  className?: string
  innerClassName?: string
  onClick?: (event: React.MouseEvent) => void
  children: ReactNode
}) {
  return (
    <div
      className={cn('scroll-thin min-h-0 min-w-0 flex-1 overflow-auto px-5 py-4', className)}
      onClick={onClick}
    >
      <div className={cn(WIDTHS[width], innerClassName)}>{children}</div>
    </div>
  )
}

/** Filter/search strip between the page header and the body. */
export function PageToolbar({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b border-border/80 px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  )
}
