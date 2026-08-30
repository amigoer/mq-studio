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
 * Reads the stored session, checking only that it has the shape it claims.
 *
 * Dropping tabs whose profile is gone needs the profiles, which land long
 * after the first render, so the shell prunes against them once they do.
 */
export function readSession(): Partial<ShellSession> {
  let parsed: Partial<ShellSession>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw) as Partial<ShellSession>;
  } catch {
    return {};
  }

  const openTabs = Array.isArray(parsed.openTabs)
    ? parsed.openTabs.filter((key): key is string => typeof key === "string")
    : undefined;
  const activeTab = typeof parsed.activeTab === "string" ? parsed.activeTab : undefined;
  const pageByTab =
    parsed.pageByTab != null && typeof parsed.pageByTab === "object"
      ? Object.fromEntries(
          Object.entries(parsed.pageByTab).filter(([, page]) => typeof page === "string"),
        )
      : undefined;

  return {
    ...(openTabs != null && { openTabs }),
    ...(activeTab != null && { activeTab }),
    ...(pageByTab != null && { pageByTab: pageByTab as Record<string, PageId> }),
    ...(typeof parsed.navCollapsed === "boolean" && { navCollapsed: parsed.navCollapsed }),
  };
}

/**
 * The stored session narrowed to the profiles that actually loaded. A tab
 * whose profile is gone must not reopen, and it takes its remembered page with
 * it; `activeTab` falls back to the first survivor, or null if none did.
 */
export function restoreSession(
  stored: Partial<ShellSession>,
  known: readonly string[],
): { openTabs: string[]; activeTab: string | null; pageByTab: Record<string, PageId> } {
  const openTabs = (stored.openTabs ?? []).filter((key) => known.includes(key));
  const activeTab =
    stored.activeTab != null && openTabs.includes(stored.activeTab)
      ? stored.activeTab
      : (openTabs[0] ?? null);
  const pageByTab = Object.fromEntries(
    Object.entries(stored.pageByTab ?? {}).filter(([key]) => openTabs.includes(key)),
  );
  return { openTabs, activeTab, pageByTab };
}

export function writeSession(session: ShellSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable; the next window then opens on the defaults.
  }
}
