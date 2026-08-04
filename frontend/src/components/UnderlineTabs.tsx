import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface UnderlineTabItem<T extends string = string> {
  key: T
  label: ReactNode
  /** Small trailing number, e.g. the instance count on a consumer group. */
  count?: ReactNode
}

/**
 * Underline tab strip used inside the detail panels.
 *
 * The three panels each hand-rolled this, and all three had `role="tab"` on the
 * buttons with no `role="tablist"` around them — which leaves the tabs
 * unannounced and, worse, unnavigable, since arrow keys do nothing without the
 * container. Roving tabindex and arrow/Home/End handling live here now.
 *
 * `bleed` pulls the underline out to the panel edge; without it the strip sits
 * inside the panel's own inset. Both use the same inset token, so the three
 * panels no longer disagree by a few pixels.
 */
export function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
  bleed,
  className,
}: {
  items: UnderlineTabItem<T>[]
  value: T
  onChange: (key: T) => void
  bleed?: boolean
  className?: string
}) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const select = (index: number) => {
    const count = items.length
    if (count === 0) return
    const item = items[((index % count) + count) % count]
    if (!item) return
    onChange(item.key)
    refs.current.get(item.key)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.key === value)
    const moves: Record<string, number | undefined> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: items.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next)
  }

  return (
    <div
      role="tablist"
      className={cn('utabs', bleed && 'utabs-bleed', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            ref={(el) => {
              if (el) refs.current.set(item.key, el)
              else refs.current.delete(item.key)
            }}
            type="button"
            role="tab"
            aria-selected={active}
            // Roving tabindex: Tab reaches the strip, arrows move within it.
            tabIndex={active ? 0 : -1}
            className={cn('utab', active && 'active')}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {item.count != null && <span className="text-muted-foreground">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
