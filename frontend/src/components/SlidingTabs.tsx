import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SlidingTabItem<T extends string = string> {
  key: T
  label: ReactNode
  count?: number
}

/**
 * Segmented control with a sliding pill indicator.
 */
export function SlidingTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: SlidingTabItem<T>[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  const measure = useCallback(() => {
    const root = rootRef.current
    const btn = btnRefs.current.get(value)
    if (!root || !btn) return
    const rootRect = root.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    setIndicator({
      left: btnRect.left - rootRect.left,
      width: btnRect.width,
      ready: true,
    })
  }, [value])

  useLayoutEffect(() => {
    measure()
  }, [measure, items])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(root)
    for (const btn of btnRefs.current.values()) ro.observe(btn)
    return () => ro.disconnect()
  }, [measure, items])

  return (
    <div ref={rootRef} className={cn('rl-tabs rl-tabs-sliding', className)} role="tablist">
      <div
        className={cn('rl-tabs-indicator', indicator.ready && 'ready')}
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width,
        }}
        aria-hidden
      />
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            ref={(el) => {
              if (el) btnRefs.current.set(item.key, el)
              else btnRefs.current.delete(item.key)
            }}
            className={cn('tab', active && 'active')}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="rl-muted font-mono-design text-[11px] tabular-nums">
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
