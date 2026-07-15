import { useEffect, useState } from 'react'

/**
 * Bridges React's mount/unmount with a CSS exit animation.
 *
 * Returns:
 *   - shouldRender: whether the consumer should render its node at all
 *   - exiting: when true, the consumer should apply its "exit" class so the
 *              CSS keyframe runs before the node is unmounted
 *
 * Honours the global `data-animations="off"` flag — when animations are
 * disabled the unmount is immediate (no flicker after close).
 */
export function useDelayedUnmount(visible: boolean, exitMs = 180) {
  const [shouldRender, setShouldRender] = useState(visible)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (visible) {
      setShouldRender(true)
      setExiting(false)
      return
    }
    if (!shouldRender) return

    const animationsOff =
      typeof document !== 'undefined' && document.documentElement.dataset.animations === 'off'

    if (animationsOff || exitMs <= 0) {
      setShouldRender(false)
      setExiting(false)
      return
    }

    setExiting(true)
    const t = window.setTimeout(() => {
      setShouldRender(false)
      setExiting(false)
    }, exitMs)
    return () => window.clearTimeout(t)
  }, [visible, shouldRender, exitMs])

  return { shouldRender, exiting }
}
