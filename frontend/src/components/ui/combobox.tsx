import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

/**
 * Free-text input with a dropdown of known values.
 *
 * Unlike `Select`, the typed value is always kept as-is: the options are only
 * shortcuts, so a value that is not in the list stays valid. The dropdown
 * trigger is hidden when there is nothing to suggest, leaving a plain input.
 */
export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  /** Label for the entry that clears the value; omitted when not provided. */
  emptyLabel?: string
  maxLength?: number
  pickerLabel?: string
  id?: string
  'aria-label'?: string
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  maxLength,
  pickerLabel,
  id,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([])
  const entries = React.useMemo(
    () => (emptyLabel === undefined ? options : ['', ...options]),
    [emptyLabel, options],
  )

  const focusItem = (start: number): void => {
    const n = entries.length
    if (n === 0) return
    itemRefs.current[((start % n) + n) % n]?.focus()
  }

  const pick = (next: string): void => {
    setOpen(false)
    onChange(next)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <Input
            id={id}
            aria-label={ariaLabel}
            className={cn(options.length > 0 && 'pr-8')}
            placeholder={placeholder}
            value={value}
            maxLength={maxLength}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
          />
          {options.length > 0 && (
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={pickerLabel}
                aria-expanded={open}
                className="text-muted-foreground absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent p-0 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
              >
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={cn('transition-transform', open && 'rotate-180')}
                />
              </button>
            </Popover.Trigger>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          role="listbox"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const idx = entries.indexOf(value)
            focusItem(idx >= 0 ? idx : 0)
          }}
          onKeyDown={(e) => {
            const idx = itemRefs.current.findIndex((n) => n === document.activeElement)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              focusItem(idx < 0 ? 0 : idx + 1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              focusItem(idx < 0 ? entries.length - 1 : idx - 1)
            }
          }}
          className={cn(
            'scroll-thin z-50 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_12px_40px_hsl(0_0%_0%/0.12),0_2px_8px_hsl(0_0%_0%/0.04)] outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
          style={{
            minWidth: 'var(--radix-popover-trigger-width)',
            maxHeight: 'min(320px, var(--radix-popover-content-available-height))',
          }}
        >
          {entries.map((entry, i) => {
            const active = entry === value
            return (
              <button
                key={entry || '__empty__'}
                ref={(n) => {
                  itemRefs.current[i] = n
                }}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(entry)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-fs-125 outline-none transition-colors hover:bg-accent focus-visible:bg-accent',
                  active && 'bg-accent/70 font-medium',
                )}
              >
                <span className={cn('min-w-0 flex-1 truncate', !entry && 'text-muted-foreground')}>
                  {entry || emptyLabel}
                </span>
                {active && <Check size={14} className="shrink-0 opacity-80" />}
              </button>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
