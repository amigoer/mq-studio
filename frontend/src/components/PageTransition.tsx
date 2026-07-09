import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'page' | 'panel' | 'fade'

/**
 * Lightweight enter animation when `transitionKey` changes.
 * Respects [data-animations='off'] via design.css.
 */
export function PageTransition({
  transitionKey,
  children,
  variant = 'page',
  className,
}: {
  transitionKey: string
  children: ReactNode
  variant?: Variant
  className?: string
}) {
  return (
    <div
      key={transitionKey}
      className={cn(
        'rl-motion-enter min-h-0',
        variant === 'page' && 'rl-motion-page h-full',
        variant === 'panel' && 'rl-motion-panel',
        variant === 'fade' && 'rl-motion-fade',
        className,
      )}
    >
      {children}
    </div>
  )
}
