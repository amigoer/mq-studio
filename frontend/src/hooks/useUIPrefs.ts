import { useCallback, useEffect, useState } from 'react'

export interface UIPrefs {
  animations: boolean
  reduceTransparency: boolean
  highContrast: boolean
}

const STORAGE_KEY = 'rocket-leaf:ui-prefs'

const DEFAULTS: UIPrefs = {
  animations: true,
  reduceTransparency: false,
  highContrast: false,
}

/** CSS vars formerly overridden by the accent-color picker */
const LEGACY_ACCENT_CSS_VARS = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--accent',
  '--accent-foreground',
  '--sidebar-active',
] as const

function loadPrefs(): UIPrefs {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<UIPrefs>
    return {
      animations: typeof parsed.animations === 'boolean' ? parsed.animations : DEFAULTS.animations,
      reduceTransparency:
        typeof parsed.reduceTransparency === 'boolean'
          ? parsed.reduceTransparency
          : DEFAULTS.reduceTransparency,
      highContrast:
        typeof parsed.highContrast === 'boolean' ? parsed.highContrast : DEFAULTS.highContrast,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function clearLegacyAccent() {
  const root = document.documentElement
  for (const v of LEGACY_ACCENT_CSS_VARS) root.style.removeProperty(v)
  root.removeAttribute('data-accent')
}

function applyPrefs(p: UIPrefs) {
  const root = document.documentElement
  clearLegacyAccent()
  root.setAttribute('data-animations', p.animations ? 'on' : 'off')
  root.classList.toggle('rl-reduce-transparency', p.reduceTransparency)
  root.classList.toggle('rl-high-contrast', p.highContrast)
}

export function useUIPrefs() {
  const [prefs, setPrefs] = useState<UIPrefs>(() => loadPrefs())

  useEffect(() => {
    applyPrefs(prefs)
    try {
      // Persist without legacy `accent` field
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // storage may be unavailable; preferences only affect current session
    }
  }, [prefs])

  const setAnimations = useCallback((animations: boolean) => {
    setPrefs((prev) => ({ ...prev, animations }))
  }, [])

  const setReduceTransparency = useCallback((reduceTransparency: boolean) => {
    setPrefs((prev) => ({ ...prev, reduceTransparency }))
  }, [])

  const setHighContrast = useCallback((highContrast: boolean) => {
    setPrefs((prev) => ({ ...prev, highContrast }))
  }, [])

  return {
    prefs,
    setAnimations,
    setReduceTransparency,
    setHighContrast,
  }
}

// Bootstrap: apply persisted prefs as early as possible to avoid FOUC.
export function bootstrapUIPrefs() {
  if (typeof document === 'undefined') return
  applyPrefs(loadPrefs())
}
