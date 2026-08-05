import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Select that can also create its own options.
 *
 * The trigger is styled exactly like `Select`, so a field backed by free text
 * still reads as a picker. The dropdown carries the text input: typing filters
 * the known values and, when nothing matches, offers to create what was typed.
 */
export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  /** Shown for the empty value — both in the trigger and as the entry that clears it. */
  emptyLabel: string
  searchPlaceholder?: string
  /** Builds the label of the "create this value" entry. Omit to forbid new values. */
  createLabel?: (value: string) => string
  maxLength?: number
  'aria-label'?: string
}

interface Entry {
  value: string
  label: React.ReactNode
  create?: boolean
}

export function Combobox({
  value,
  onChange,
  options,
  emptyLabel,
  searchPlaceholder,
  createLabel,
  maxLength,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  const trimmed = query.trim()
  const entries = React.useMemo<Entry[]>(() => {
    const needle = trimmed.toLowerCase()
    const matches = (candidate: string) => candidate.toLowerCase().includes(needle)
    const out: Entry[] = []
    if (matches(emptyLabel)) out.push({ value: '', label: emptyLabel })
    for (const option of options) {
      if (matches(option)) out.push({ value: option, label: option })
    }
    if (createLabel && trimmed !== '' && !options.includes(trimmed)) {
      out.push({ value: trimmed, label: createLabel(trimmed), create: true })
    }
    return out
  }, [createLabel, emptyLabel, options, trimmed])

  // Radix only reports the open changes it drives, so closing from an option
  // click has to reset the query here or it leaks into the next open.
  const setOpenState = (next: boolean): void => {
    setOpen(next)
    setQuery('')
  }

  const commit = (next: string): void => {
    setOpenState(false)
    onChange(next)
  }

  const focusItem = (start: number): void => {
    const n = entries.length
    if (n === 0) return
    itemRefs.current[((start % n) + n) % n]?.focus()
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpenState}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          className="group flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 py-1 text-fs-125 text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring/20 data-[state=open]:border-ring/40 data-[state=open]:ring-2 data-[state=open]:ring-ring/20"
        >
          <span className={cn('min-w-0 flex-1 truncate text-left', !value && 'text-muted-foreground')}>
            {value || emptyLabel}
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
          align="start"
          sideOffset={4}
          className={cn(
            'z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_12px_40px_hsl(0_0%_0%/0.12),0_2px_8px_hsl(0_0%_0%/0.04)] outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
          style={{
            minWidth: 'var(--radix-popover-trigger-width)',
            maxWidth: 'max(var(--radix-popover-trigger-width), 18rem)',
          }}
        >
          <input
            autoFocus
            value={query}
            maxLength={maxLength}
            spellCheck={false}
            autoComplete="off"
            placeholder={searchPlaceholder}
            className="mb-1 h-7 w-full rounded-md border-0 bg-transparent px-2 text-fs-125 text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                // Commit what was typed: an exact existing name selects it, a
                // new one creates it. An empty box just closes the dropdown.
                if (trimmed === '') setOpenState(false)
                else if (createLabel) commit(trimmed)
                else if (entries[0]) commit(entries[0].value)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                focusItem(0)
              }
            }}
          />
          <div
            role="listbox"
            className="scroll-thin overflow-y-auto"
            style={{ maxHeight: 'min(280px, var(--radix-popover-content-available-height))' }}
            onKeyDown={(e) => {
              const idx = itemRefs.current.findIndex((n) => n === document.activeElement)
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                focusItem(idx + 1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                focusItem(idx < 0 ? entries.length - 1 : idx - 1)
              }
            }}
          >
            {entries.map((entry, i) => {
              const active = !entry.create && entry.value === value
              return (
                <button
                  key={`${entry.create ? 'create:' : ''}${entry.value}`}
                  ref={(n) => {
                    itemRefs.current[i] = n
                  }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => commit(entry.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-fs-125 outline-none transition-colors hover:bg-accent focus-visible:bg-accent',
                    active && 'bg-accent/70 font-medium',
                  )}
                >
                  {entry.create && (
                    <Plus size={13} aria-hidden className="shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      !entry.create && !entry.value && 'text-muted-foreground',
                    )}
                  >
                    {entry.label}
                  </span>
                  {active && <Check size={14} className="shrink-0 opacity-80" />}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
