import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? 'checked' : 'unchecked'}
        disabled={disabled}
        ref={ref}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          // Matches the design spec 1:1 (track 34x20, thumb 16, offset 0/14).
          // All fixed px so the control never scales with `--app-font-size`.
          'peer relative inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/30 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-success' : 'bg-[hsl(0_0%_60%/0.35)]',
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none absolute left-[2px] top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_2px_hsl(0_0%_0%/0.2)] transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
            checked ? 'translate-x-[14px]' : 'translate-x-0',
          )}
        />
      </button>
    )
  },
)
Switch.displayName = 'Switch'

export { Switch }
