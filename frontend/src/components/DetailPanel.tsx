import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Shell for the right-hand detail pane: width, edge, background, entrance and
 * exit animation, and the accessible name.
 *
 * Deliberately only the shell — the three panels hold genuinely different
 * content and forcing a shared body would be a false abstraction. What they
 * should not differ on is the frame, and they did: 360, 420 and 460px, with
 * the topic panel switching width between its loading and loaded states.
 *
 * The width is capped against the viewport as well, so a narrow window no
 * longer leaves the list squeezed against the panel.
 */
export function DetailPanel({
  exiting,
  ariaLabel,
  /** `scroll`: the whole panel scrolls. `column`: caller manages its own scroll region. */
  layout = 'scroll',
  className,
  children,
}: {
  exiting: boolean
  ariaLabel: string
  layout?: 'scroll' | 'column'
  className?: string
  children: ReactNode
}) {
  return (
    <aside
      aria-label={ariaLabel}
      className={cn(
        'scroll-thin detail-panel shrink-0 border-l border-border bg-background',
        layout === 'scroll' ? 'overflow-auto' : 'flex min-h-0 flex-col overflow-hidden',
        exiting && 'exiting',
        className,
      )}
      style={{ width: 'min(32rem, 40vw)', minWidth: '20rem' }}
    >
      {children}
    </aside>
  )
}
