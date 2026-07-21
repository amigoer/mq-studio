import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Non-native, cross-platform-consistent select.
 *
 * Drop-in replacement for the previous native `<select>` wrapper: it keeps the
 * same call-site API — `value`, `onChange(e => e.target.value)`, and `<option>`
 * children — but renders a portalled, styled dropdown (built on Radix Popover)
 * so it looks identical on every platform. No `<select>` element is used, so
 * the OS-native picker never appears.
 */

interface ParsedOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

/** Flatten `<option>` children (through arrays and fragments) into a flat list. */
function parseOptions(children: React.ReactNode): ParsedOption[] {
  const out: ParsedOption[] = []
  const walk = (nodes: React.ReactNode): void => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children)
        return
      }
      if (child.type === 'option') {
        const p = child.props as {
          value?: string | number
          children?: React.ReactNode
          disabled?: boolean
        }
        const value = p.value === undefined ? '' : String(p.value)
        out.push({ value, label: p.children ?? value, disabled: p.disabled })
      }
    })
  }
  walk(children)
  return out
}

export interface SelectChangeEvent {
  target: { value: string }
  currentTarget: { value: string }
}

export interface SelectProps {
  value?: string | number
  onChange?: (event: SelectChangeEvent) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
  placeholder?: string
  id?: string
  name?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onChange, disabled, className, style, children, placeholder, ...rest },
  ref,
) {
  const [open, setOpen] = React.useState(false)
  const options = React.useMemo(() => parseOptions(children), [children])
  const currentValue = value === undefined ? '' : String(value)
  const selected = options.find((o) => o.value === currentValue)
  const isPlaceholder = !selected || selected.value === ''
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  const emit = (v: string): void => {
    setOpen(false)
    onChange?.({ target: { value: v }, currentTarget: { value: v } })
  }

  const focusItem = (start: number): void => {
    const n = options.length
    if (n === 0) return
    let idx = ((start % n) + n) % n
    for (let step = 0; step < n; step++) {
      if (!options[idx]?.disabled) {
        itemRefs.current[idx]?.focus()
        return
      }
      idx = (idx + 1) % n
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'group flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 py-1 text-[12.5px] text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-ring/40 data-[state=open]:ring-2 data-[state=open]:ring-ring/20',
            className,
          )}
          style={style}
          {...rest}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              isPlaceholder && 'text-muted-foreground',
            )}
          >
            {selected ? selected.label : (placeholder ?? '')}
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className="shrink-0 opacity-50 transition-transform group-data-[state=open]:rotate-180"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="listbox"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const idx = options.findIndex((o) => o.value === currentValue && !o.disabled)
            focusItem(idx >= 0 ? idx : 0)
          }}
          onKeyDown={(e) => {
            const idx = itemRefs.current.findIndex((n) => n === document.activeElement)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              focusItem(idx < 0 ? 0 : idx + 1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              focusItem(idx < 0 ? options.length - 1 : idx - 1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              focusItem(0)
            } else if (e.key === 'End') {
              e.preventDefault()
              focusItem(options.length - 1)
            }
          }}
          className={cn(
            'rl-scroll z-50 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_12px_40px_hsl(0_0%_0%/0.12),0_2px_8px_hsl(0_0%_0%/0.04)] outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
          style={{
            minWidth: 'var(--radix-popover-trigger-width)',
            maxHeight: 'min(320px, var(--radix-popover-content-available-height))',
          }}
        >
          {options.map((o, i) => {
            const active = o.value === currentValue
            return (
              <button
                key={`${o.value}-${i}`}
                ref={(n) => {
                  itemRefs.current[i] = n
                }}
                type="button"
                role="option"
                aria-selected={active}
                disabled={o.disabled}
                onClick={() => emit(o.value)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50',
                  active && 'bg-accent/70 font-medium',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {active && <Check size={14} className="shrink-0 opacity-80" />}
              </button>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})

Select.displayName = 'Select'

export { Select }
