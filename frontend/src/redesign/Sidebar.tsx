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
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Browser } from '@wailsio/runtime'
import { cn } from '@/lib/utils'

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
      <button
        key={id}
        type="button"
        className={cn('rl-nav-item', isActive && 'active', disabled && 'disabled')}
        title={disabled ? t('common.connectFirst') : label}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && onSelect(id)}
      >
        <Icon size={15} strokeWidth={1.75} className="rl-nav-icon" />
        <span className="rl-nav-label">{label}</span>
      </button>
    )
  }

  const openGitHub = () => {
    Browser.OpenURL(GITHUB_URL).catch(() => {
      window.open(GITHUB_URL, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <aside className="rl-sidebar">
      <nav className="rl-sidebar-nav">
        {GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            {group.labelKey ? (
              <div className="rl-nav-group-label">{t(group.labelKey)}</div>
            ) : gi > 0 ? (
              <div className="rl-nav-gap" />
            ) : null}
            <div className="rl-nav-group">{group.items.map(renderItem)}</div>
          </Fragment>
        ))}
      </nav>
      <div className="rl-sidebar-footer">
        <div className="rl-nav-divider" />
        <button type="button" className="rl-nav-item" title={t('nav.github')} onClick={openGitHub}>
          <Github size={15} strokeWidth={1.75} className="rl-nav-icon" />
          <span className="rl-nav-label">{t('nav.github')}</span>
        </button>
        {BOTTOM.map(renderItem)}
      </div>
    </aside>
  )
}
