import * as React from 'react'
import { cn } from '@/lib/utils'

/** Native select styled to match Input — keeps existing form behavior without Radix Select complexity. */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-[12.5px] text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  },
)
Select.displayName = 'Select'

export { Select }
