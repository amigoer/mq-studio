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

export function Spark({
  data,
  color = 'currentColor',
  height = 32,
}: {
  data: number[]
  color?: string
  height?: number
}) {
  if (data.length === 0) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const w = 120
  const step = w / (data.length - 1)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`)
    .join(' ')
  const area = `0,${height} ${pts} ${w},${height}`
  return (
    <svg className="rl-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <polygon points={area} fill={color} opacity={0.08} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function highlightJSON(src: string): string {
  const ESC = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return ESC(src).replace(
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g,
    (m, key, str, bool, nul, num, br) => {
      if (key) return `<span class="k">${key.slice(0, -1)}</span><span class="p">:</span>`
      if (str) return `<span class="s">${str}</span>`
      if (bool) return `<span class="b">${bool}</span>`
      if (nul) return `<span class="nu">${nul}</span>`
      if (num) return `<span class="n">${num}</span>`
      if (br) return `<span class="br">${br}</span>`
      return m
    },
  )
}

export function JSONView({
  src,
  lineNumbers = true,
  maxHeight = 240,
  style,
}: {
  src: string
  lineNumbers?: boolean
  maxHeight?: number
  style?: React.CSSProperties
}) {
  const html = highlightJSON(src)
  if (!lineNumbers) {
    return (
      <pre
        className="rl-json-view"
        style={{ maxHeight, ...style }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  const lines = src.split('\n')
  const codeLines = html.split('\n')
  return (
    <div className="rl-json-view with-lines" style={{ maxHeight, ...style }}>
      <div className="ln-col">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="code-col" style={{ overflow: 'auto' }}>
        {codeLines.map((l, i) => (
          <div key={i} dangerouslySetInnerHTML={{ __html: l || '&nbsp;' }} />
        ))}
      </div>
    </div>
  )
}
