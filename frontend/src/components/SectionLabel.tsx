import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The small uppercase heading that separates groups inside a page or panel.
 *
 * The gap above a section used to be an inline `marginTop` that varied between
 * 4, 20 and 24px depending on which file it was copied into; it is one value
 * here, in rem, so the rhythm holds at every font size.
 */
export function SectionLabel({
  children,
  /** First label in its container — drops the leading gap. */
  first,
  className,
}: {
  children: ReactNode
  first?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-2.5 text-fs-11 font-semibold uppercase tracking-[0.08em] text-muted-foreground',
        !first && 'mt-7',
        className,
      )}
    >
      {children}
    </div>
  )
}
