import { Fragment } from 'react'
import {
  Home,
  LayoutGrid,
  Users,
  Mail,
  Send,
  BarChart3,
  Bell,
  Shield,
  Server,
  Settings,
  Github,
  ExternalLink,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { openExternal } from '@/api/platform'

const GITHUB_URL = 'https://github.com/amigoer/mq-studio'

export type NavId =
  | 'home'
  | 'topics'
  | 'consumers'
  | 'messages'
  | 'producer'
  | 'cluster'
  | 'alerts'
  | 'acl'
  | 'connections'
  | 'github'
  | 'settings'

type NavItem = { id: NavId; icon: LucideIcon; labelKey: string }

type NavGroup = { labelKey?: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    items: [{ id: 'home', icon: Home, labelKey: 'nav.home' }],
  },
  {
    labelKey: 'nav.groupBrowse',
    items: [
      { id: 'topics', icon: LayoutGrid, labelKey: 'nav.topics' },
      { id: 'consumers', icon: Users, labelKey: 'nav.consumers' },
      { id: 'messages', icon: Mail, labelKey: 'nav.messages' },
      { id: 'producer', icon: Send, labelKey: 'nav.producer' },
    ],
  },
  {
    labelKey: 'nav.groupOps',
    items: [
      { id: 'cluster', icon: BarChart3, labelKey: 'nav.cluster' },
      { id: 'alerts', icon: Bell, labelKey: 'nav.alerts' },
      { id: 'acl', icon: Shield, labelKey: 'nav.acl' },
    ],
  },
  {
    items: [{ id: 'connections', icon: Server, labelKey: 'nav.connections' }],
  },
]

const BOTTOM: NavItem[] = [{ id: 'settings', icon: Settings, labelKey: 'nav.settings' }]

/**
 * Shared by this rail and the Settings section rail.
 *
 * The selected item used to be `bg-accent` alone — 97% grey on a pure-white
 * canvas, a 3% step that was effectively invisible. It now carries a brand-green
 * tint plus a left indicator, so the current page reads at a glance.
 */
export function navItemClass(isActive: boolean): string {
  return cn(
    'relative h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-normal text-muted-foreground shadow-none',
    isActive
      ? 'bg-brand/10 font-medium text-foreground before:absolute before:left-0 before:top-1/2 before:h-1/2 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-brand'
      : 'hover:bg-accent hover:text-foreground',
  )
}

export function Sidebar({
  active,
  onSelect,
  disabledIds = [],
  dotIds = [],
}: {
  active: NavId
  onSelect: (id: NavId) => void
  disabledIds?: NavId[]
  /** Items carrying an unread marker, such as an update waiting in Settings. */
  dotIds?: NavId[]
}) {
  const { t } = useTranslation()

  const renderItem = (item: NavItem) => {
    const { id, icon: Icon, labelKey } = item
    const label = t(labelKey)
    const disabled = disabledIds.includes(id)
    const isActive = active === id
    const dot = dotIds.includes(id)

    return (
      <Button
        key={id}
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        title={disabled ? t('common.connectFirst') : label}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => !disabled && onSelect(id)}
        className={navItemClass(isActive)}
      >
        <Icon
          size={15}
          strokeWidth={isActive ? 2 : 1.75}
          className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-80')}
        />
        <span className="truncate">{label}</span>
        {dot && (
          <span
            role="status"
            aria-label={t('nav.updateAvailable')}
            title={t('nav.updateAvailable')}
            className="ml-auto h-[7px] w-[7px] shrink-0 rounded-full bg-brand"
          />
        )}
      </Button>
    )
  }

  const openGitHub = () => {
    openExternal(GITHUB_URL).catch(() => {
      toast.error(t('nav.githubOpenFailed'))
    })
  }

  return (
    <aside className="flex w-[15.38rem] shrink-0 select-none flex-col border-r border-border/80 bg-background">
      <nav className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 py-3">
        {GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            <div className="flex flex-col gap-0.5">
              {group.labelKey ? (
                <div className="px-2.5 pb-1 pt-0.5 text-fs-105 font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {t(group.labelKey)}
                </div>
              ) : null}
              {group.items.map(renderItem)}
            </div>
          </Fragment>
        ))}
      </nav>
      <div className="px-2.5 pb-3 pt-1">
        <Separator className="mb-2" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={t('nav.githubHint')}
          onClick={openGitHub}
          className={cn('group', navItemClass(false))}
        >
          <Github size={15} strokeWidth={1.75} className="shrink-0 opacity-80" />
          <span className="truncate">{t('nav.github')}</span>
          <ExternalLink
            size={12}
            aria-hidden
            className="ml-auto shrink-0 opacity-40 transition-opacity group-hover:opacity-70"
          />
        </Button>
        {BOTTOM.map(renderItem)}
      </div>
    </aside>
  )
}
