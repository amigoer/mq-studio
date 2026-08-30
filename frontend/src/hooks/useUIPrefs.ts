import { useCallback, useEffect, useState } from "react";

export interface UIPrefs {
  animations: boolean;
}

const STORAGE_KEY = "mq-studio:ui-prefs";

/**
 * Nothing stored yet: follow the OS. Someone who has asked their system to
 * reduce motion should not have to find this toggle. An explicit choice is
 * persisted and wins from then on.
 */
function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function defaults(): UIPrefs {
  return { animations: !systemPrefersReducedMotion() };
}

/** CSS vars formerly overridden by the accent-color picker */
const LEGACY_ACCENT_CSS_VARS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--accent",
  "--accent-foreground",
  "--sidebar-active",
] as const;

function loadPrefs(): UIPrefs {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<UIPrefs>;
    return {
      animations:
        typeof parsed.animations === "boolean"
          ? parsed.animations
          : defaults().animations,
    };
  } catch {
    return defaults();
  }
}

function clearLegacyAccent() {
  const root = document.documentElement;
  for (const v of LEGACY_ACCENT_CSS_VARS) root.style.removeProperty(v);
  root.removeAttribute("data-accent");
}

function applyPrefs(p: UIPrefs) {
  const root = document.documentElement;
  clearLegacyAccent();
  root.setAttribute("data-animations", p.animations ? "on" : "off");
}

export function useUIPrefs() {
  const [prefs, setPrefs] = useState<UIPrefs>(() => loadPrefs());

  useEffect(() => {
    applyPrefs(prefs);
    try {
      // Persist without legacy `accent` field
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // storage may be unavailable; preferences only affect current session
    }
  }, [prefs]);

  const setAnimations = useCallback((animations: boolean) => {
    setPrefs((prev) => ({ ...prev, animations }));
  }, []);

  return {
    prefs,
    setAnimations,
  };
}

// Bootstrap: apply persisted prefs as early as possible to avoid FOUC.
export function bootstrapUIPrefs() {
  if (typeof document === "undefined") return;
  applyPrefs(loadPrefs());
}
