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

const GITHUB_URL = 'https://github.com/amigoer/rocket-leaf'

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

export function Sidebar({
  active,
  onSelect,
  disabledIds = [],
}: {
  active: NavId
  onSelect: (id: NavId) => void
  disabledIds?: NavId[]
}) {
  const { t } = useTranslation()

  const renderItem = (item: NavItem) => {
    const { id, icon: Icon, labelKey } = item
    const label = t(labelKey)
    const disabled = disabledIds.includes(id)
    const isActive = active === id

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
        className={cn(
          'h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-normal text-muted-foreground shadow-none',
          isActive && 'bg-accent font-medium text-foreground',
          !isActive && 'hover:bg-accent/70 hover:text-foreground',
        )}
      >
        <Icon size={15} strokeWidth={isActive ? 2 : 1.75} className="shrink-0 opacity-80" />
        <span className="truncate">{label}</span>
      </Button>
    )
  }

  const openGitHub = () => {
    window.rocketLeaf.shell.openExternal(GITHUB_URL).catch(() => {
      toast.error(t('nav.githubOpenFailed'))
    })
  }

  return (
    <aside className="flex w-[200px] shrink-0 select-none flex-col border-r border-border/80 bg-background">
      <nav className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 py-3">
        {GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            <div className="flex flex-col gap-0.5">
              {group.labelKey ? (
                <div className="px-2.5 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
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
          className="group h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-normal text-muted-foreground shadow-none hover:bg-accent/70 hover:text-foreground"
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
