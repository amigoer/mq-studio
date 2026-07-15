import type { CSSProperties } from 'react'

function highlightJSON(src: string): string {
  const escape = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escape(src).replace(
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

export function JsonView({
  src,
  lineNumbers = true,
  maxHeight = 240,
  style,
}: {
  src: string
  lineNumbers?: boolean
  maxHeight?: number
  style?: CSSProperties
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
