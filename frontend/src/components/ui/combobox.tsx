import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { filterOptions } from '@/lib/optionFilter'
import { cn } from '@/lib/utils'

/**
 * Select that can also create its own options.
 *
 * The trigger is styled exactly like `Select`, so a field backed by free text
 * still reads as a picker. The dropdown carries the text input: typing filters
 * the known values and, when nothing matches, offers to create what was typed.
 *
 * Lists long enough to be unscrollable — a cluster's topics or consumer groups —
 * pass `recent` to pin the values last used above the full list.
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
  /** Values to pin above the rest, newest first. Entries absent from `options` are ignored. */
  recent?: string[]
  recentLabel?: string
  allLabel?: string
  /** Shown when the query matches nothing and no new value can be created. */
  emptyMessage?: string
  /** Builds the footer telling how many matches were left out of the rendered list. */
  moreHint?: (count: number) => string
  maxLength?: number
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
}

type Section = 'recent' | 'all'

interface Entry {
  value: string
  label: React.ReactNode
  create?: boolean
  section?: Section
}

export function Combobox({
  value,
  onChange,
  options,
  emptyLabel,
  searchPlaceholder,
  createLabel,
  recent,
  recentLabel,
  allLabel,
  emptyMessage,
  moreHint,
  maxLength,
  disabled,
  className,
  style,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  const trimmed = query.trim()

  // A remembered value the cluster no longer has must not be offered — it would
  // silently query or send to a topic that is not in the list below it.
  const [pinned, rest] = React.useMemo(() => {
    if (!recent || recent.length === 0) return [[] as string[], options]
    const known = new Set(options)
    const head = recent.filter((entry) => known.has(entry))
    if (head.length === 0) return [[] as string[], options]
    const pinnedSet = new Set(head)
    return [head, options.filter((entry) => !pinnedSet.has(entry))]
  }, [options, recent])

  const { entries, hidden, sectioned } = React.useMemo(() => {
    const needle = trimmed.toLowerCase()
    const pinnedMatches = filterOptions(pinned, trimmed)
    const restMatches = filterOptions(rest, trimmed)
    const withSections = pinnedMatches.items.length > 0
    const out: Entry[] = []
    if (emptyLabel.toLowerCase().includes(needle)) out.push({ value: '', label: emptyLabel })
    for (const option of pinnedMatches.items) {
      out.push({ value: option, label: option, section: 'recent' })
    }
    for (const option of restMatches.items) {
      out.push({ value: option, label: option, section: 'all' })
    }
    if (createLabel && trimmed !== '' && !options.includes(trimmed)) {
      out.push({ value: trimmed, label: createLabel(trimmed), create: true })
    }
    return { entries: out, hidden: restMatches.hidden, sectioned: withSections }
  }, [createLabel, emptyLabel, options, pinned, rest, trimmed])

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

  const sectionLabel = (section: Section): string | undefined =>
    section === 'recent' ? recentLabel : allLabel

  return (
    <Popover.Root open={open} onOpenChange={setOpenState}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          style={style}
          className={cn(
            'group flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 py-1 text-fs-125 text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-ring/40 data-[state=open]:ring-2 data-[state=open]:ring-ring/20',
            className,
          )}
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
            {entries.length === 0 && emptyMessage && (
              <div className="text-muted-foreground px-2 py-2 text-fs-115">{emptyMessage}</div>
            )}
            {entries.map((entry, i) => {
              const active = !entry.create && entry.value === value
              // Headings are plain text, so they take no slot in `itemRefs` and
              // arrow keys keep stepping through options only.
              const heading =
                sectioned && entry.section && entry.section !== entries[i - 1]?.section
                  ? sectionLabel(entry.section)
                  : undefined
              return (
                <React.Fragment key={`${entry.create ? 'create:' : ''}${entry.value}`}>
                  {heading && (
                    <div
                      role="presentation"
                      className="text-muted-foreground px-2 pb-0.5 pt-1.5 text-fs-105 font-medium"
                    >
                      {heading}
                    </div>
                  )}
                  <button
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
                </React.Fragment>
              )
            })}
          </div>
          {hidden > 0 && moreHint && (
            <div className="text-muted-foreground border-t border-border px-2 py-1.5 text-fs-105">
              {moreHint(hidden)}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
