import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="rl-page-header">
      <div className="min-w-0">
        <div className="rl-page-title">{title}</div>
        {subtitle && <div className="rl-page-subtitle">{subtitle}</div>}
      </div>
      {children && <div className="right">{children}</div>}
    </div>
  )
}
