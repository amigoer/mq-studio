import { useState, useRef, useCallback } from 'react'
import { Home, LayoutGrid, Users, Mail, BarChart3, Server, Github, Settings } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import { cn } from '@/lib/utils'

const GITHUB_URL = 'https://github.com/amigoer/rocket-leaf'

export type NavId = 'home' | 'topics' | 'consumers' | 'messages' | 'cluster' | 'connections' | 'settings' | 'github'

const TOOLTIP_DELAY_MS = 150

const MAIN_NAV: { id: NavId; icon: React.ElementType; label: string; href?: string }[] = [
  { id: 'home', icon: Home, label: '概览' },
  { id: 'topics', icon: LayoutGrid, label: '主题' },
  { id: 'consumers', icon: Users, label: '消费者组' },
  { id: 'messages', icon: Mail, label: '消息' },
  { id: 'cluster', icon: BarChart3, label: '集群' },
  { id: 'connections', icon: Server, label: '连接管理' },
]

const BOTTOM_NAV: { id: NavId; icon: React.ElementType; label: string; href?: string }[] = [
  { id: 'github', icon: Github, label: 'GitHub', href: GITHUB_URL },
  { id: 'settings', icon: Settings, label: '设置' },
]

export function IconSidebar({
  active,
  onSelect,
  disabledIds = [],
}: {
  active: NavId
  onSelect: (id: NavId) => void
  disabledIds?: NavId[]
}) {
  const [hoveredId, setHoveredId] = useState<NavId | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleEnter = useCallback(
    (id: NavId) => {
      clearTimer()
      timerRef.current = setTimeout(() => setHoveredId(id), TOOLTIP_DELAY_MS)
    },
    [clearTimer]
  )
  const handleLeave = useCallback(() => {
    clearTimer()
    setHoveredId(null)
  }, [clearTimer])

  const renderItem = (item: (typeof MAIN_NAV)[0], isBottom = false) => {
    const { id, icon: Icon, label, href } = item
    const disabled = !isBottom && disabledIds.includes(id)
    const isLink = Boolean(href)
    const isActive = active === id

    const buttonClass = cn(
      'flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color] duration-200 ease-out',
      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
      disabled && 'opacity-40 cursor-not-allowed'
    )

    // 禁用时显示"请先连接集群"提示，正常时显示功能名称
    const tooltipLabel = disabled ? '请先连接集群' : label

    const content = (
      <>
        <Icon className="h-[22px] w-[22px]" />
        {hoveredId === id && (
          <span
            className={cn(
              'absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border px-3 py-2 text-base shadow-sm',
              disabled
                ? 'border-orange-500/30 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-950/80 dark:text-orange-300'
                : 'border-border/50 bg-card text-card-foreground'
            )}
            role="tooltip"
          >
            {tooltipLabel}
          </span>
        )}
      </>
    )

    const handleLinkClick = () => {
      if (!href) return
      Browser.OpenURL(href).catch(() => window.open(href, '_blank', 'noopener,noreferrer'))
    }

    return (
      <div key={id} className="relative">
        {isLink ? (
          <button
            type="button"
            onClick={handleLinkClick}
            onMouseEnter={() => handleEnter(id)}
            onMouseLeave={handleLeave}
            className={buttonClass}
            aria-label={label}
          >
            {content}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => !disabled && onSelect(id)}
            onMouseEnter={() => handleEnter(id)}
            onMouseLeave={handleLeave}
            className={buttonClass}
            aria-label={disabled ? '请先连接集群' : label}
            aria-disabled={disabled || undefined}
            aria-current={isActive ? 'page' : undefined}
          >
            {content}
          </button>
        )}
      </div>
    )
  }

  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-border/40 bg-muted/30 transition-[background-color,border-color] duration-200 ease-out">
      <nav className="flex flex-1 flex-col items-center gap-1 p-2">
        {MAIN_NAV.map((item) => renderItem(item))}
      </nav>
      <nav className="flex flex-col items-center gap-1 border-t border-border/40 p-2">
        {BOTTOM_NAV.map((item) => renderItem(item, true))}
      </nav>
    </aside>
  )
}

