import { DOCK_MAX, DOCK_MIN } from "@/design/shell/AppShell";

/**
 * Whether the dock is open and how wide it was left: window state, kept on
 * this machine like the shell session.
 *
 * Its own key rather than a field of `mq-studio:ui-prefs`, which the settings
 * page writes back whole from the copy it read when it opened - and that copy
 * would put back whatever the dock had been when the page opened.
 */
export type DockPrefs = { open: boolean; width: number };

const STORAGE_KEY = "mq-studio:assistant-dock";
export const DOCK_DEFAULT_WIDTH = 400;

export function readDockPrefs(): DockPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw == null ? {} : (JSON.parse(raw) as Partial<DockPrefs>);
    const width = typeof parsed.width === "number" ? parsed.width : DOCK_DEFAULT_WIDTH;
    return {
      open: parsed.open === true,
      width: Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.round(width))),
    };
  } catch {
    return { open: false, width: DOCK_DEFAULT_WIDTH };
  }
}

export function writeDockPrefs(prefs: DockPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable; the dock then opens as it was left this run.
  }
}
