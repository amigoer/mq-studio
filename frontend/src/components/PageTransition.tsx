import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'page' | 'panel' | 'fade'

/**
 * Lightweight enter animation when `transitionKey` changes.
 * Respects [data-animations='off'] via styles/app.css.
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
        'mqs-motion-enter min-h-0',
        variant === 'page' && 'mqs-motion-page h-full',
        variant === 'panel' && 'mqs-motion-panel',
        variant === 'fade' && 'mqs-motion-fade',
        className,
      )}
    >
      {children}
    </div>
  )
}
