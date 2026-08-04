import type { CSSProperties } from 'react'

interface SpinnerProps {
  /** Outer diameter in px. Defaults to 14. */
  size?: number
  /** Ring thickness. Defaults to scale to size (~1.5–2px). */
  thickness?: number
  className?: string
  style?: CSSProperties
}

/**
 * A small refined spinner used for any in-flight action — refresh, save,
 * send, etc. Renders a conic-gradient "comet tail" ring (no hard edges)
 * with a rounded head dot. Inherits `currentColor` so it sits naturally
 * on any button surface.
 */
export function Spinner({ size = 14, thickness, className = '', style }: SpinnerProps) {
  const t = thickness ?? Math.max(1.5, size / 8)
  return (
    <span
      role="status"
      aria-label="loading"
      className={`rl-spinner ${className}`}
      style={
        {
          width: size,
          height: size,
          '--rl-spinner-thickness': `${t}px`,
          ...style,
        } as CSSProperties
      }
    />
  )
}
