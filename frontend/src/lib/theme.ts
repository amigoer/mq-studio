/*
 * Theme resolution, shared by the first-frame bootstrap that index.html loads
 * and the settings store that owns the choice from then on.
 */

export type ThemeMode = "system" | "light" | "dark";

/** Mirrors the chosen theme for the next launch's first frame. */
const CACHE_KEY = "mq-studio:theme";

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** What a mode means right now: "system" is whatever the OS is set to. */
export function resolveDark(mode: ThemeMode): boolean {
  return mode === "system" ? systemPrefersDark() : mode === "dark";
}

/** Writes the resolved theme to the document, and reports what was applied. */
export function applyTheme(mode: ThemeMode): boolean {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  return dark;
}

/**
 * The settings live in Go and arrive a tick after the window opens, so the
 * choice is cached here for the first frame to read.
 */
export function readCachedTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

export function cacheTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(CACHE_KEY, mode);
  } catch {
    // Storage may be unavailable; the first frame then opens on the default.
  }
}
