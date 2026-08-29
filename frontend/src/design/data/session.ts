import type { PageId } from "./protocols";

/**
 * Which tabs are open, which one is in front, and what page each is showing.
 *
 * Window state rather than settings: it belongs to this machine's window, not
 * to the configuration an exported file carries, so it lives in localStorage
 * beside the UI scale mirror instead of in the settings file.
 */
export type ShellSession = {
  openTabs: string[];
  activeTab: string | null;
  pageByTab: Record<string, PageId>;
  navCollapsed: boolean;
};

const STORAGE_KEY = "mq-studio:shell-session";

/**
 * Reads the stored session, dropping tabs whose connection is gone: a profile
 * deleted in another window would otherwise reopen as a tab with nothing
 * behind it.
 */
export function readSession(known: readonly string[]): Partial<ShellSession> {
  let parsed: Partial<ShellSession>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw) as Partial<ShellSession>;
  } catch {
    return {};
  }

  const openTabs = Array.isArray(parsed.openTabs)
    ? parsed.openTabs.filter((key): key is string => typeof key === "string" && known.includes(key))
    : undefined;
  const activeTab =
    typeof parsed.activeTab === "string" && openTabs?.includes(parsed.activeTab)
      ? parsed.activeTab
      : undefined;
  const pageByTab =
    parsed.pageByTab != null && typeof parsed.pageByTab === "object"
      ? Object.fromEntries(
          Object.entries(parsed.pageByTab).filter(([key]) => openTabs?.includes(key)),
        )
      : undefined;

  return {
    ...(openTabs != null && { openTabs }),
    ...(activeTab != null && { activeTab }),
    ...(pageByTab != null && { pageByTab: pageByTab as Record<string, PageId> }),
    ...(typeof parsed.navCollapsed === "boolean" && { navCollapsed: parsed.navCollapsed }),
  };
}

export function writeSession(session: ShellSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable; the next window then opens on the defaults.
  }
}
