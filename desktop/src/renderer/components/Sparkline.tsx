export function Sparkline({
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
