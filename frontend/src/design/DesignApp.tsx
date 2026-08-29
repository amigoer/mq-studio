import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  AppShell,
  CommandPalette,
  ConnectionTabs,
  NotificationCenter,
  Sidebar,
  TabStatusBar,
  TitleBar,
} from "@/design/shell";
import type { Connection } from "@/design/data/connections";
import { labelOf, pagesOf, type PageId } from "@/design/data/protocols";
import { renderBoard } from "@/design/registry";
import {
  onTrayNavigate,
  openExternal,
  reportShellSession,
  type TrayDestination,
} from "@/api/platform";
import { useUIScale } from "@/hooks/useUIScale";
import { useUpdater } from "@/hooks/useUpdater";
import { useConnectionProfiles } from "@/hooks/useConnectionProfiles";
import { useConfirm, useToast } from "@/design/ui";
import { exportAllConfigToFile, importAllConfigFromFile } from "@/api/settings";
import { readSession, writeSession } from "@/design/data/session";
import { UNREAD_ALERTS } from "@/design/shell/NotificationCenter";
import { ConnectionsList } from "@/design/boards/connections/ConnectionsList";
import { ConnectionsEmpty } from "@/design/boards/connections/ConnectionsEmpty";
import { NewConnectionDialog } from "@/design/boards/connections/NewConnectionDialog";
import { Settings, type DocId, type SectionId } from "@/design/boards/settings/Settings";
import { SplitCompare } from "@/design/boards/split/SplitCompare";
import { CapabilityMatrix } from "@/design/boards/docs/CapabilityMatrix";
import { ReuseStrategy } from "@/design/boards/docs/ReuseStrategy";
import { NavModel } from "@/design/boards/docs/NavModel";

/** Global views sit beside the connection tabs rather than inside one. */
type View =
  | { kind: "tab" }
  | { kind: "connections" }
  | { kind: "settings"; section?: SectionId }
  | { kind: "split" }
  | { kind: "doc"; doc: DocId };

const DOCS: Record<DocId, () => JSX.Element> = {
  capability: CapabilityMatrix,
  reuse: ReuseStrategy,
  nav: NavModel,
};

const GITHUB_URL = "https://github.com/amigoer/mq-studio";

/**
 * The repository link goes through Go rather than window.open: the webview has
 * no browser to open a tab in, and SystemService.OpenExternal is where the
 * host allow-list lives. It rejects anything off github.com, which is nothing
 * a user can act on, so a failure stays quiet.
 */
const openGithub = () => void openExternal(GITHUB_URL).catch(() => {});

/**
 * The design canvas realised: window → connection tab → page (5c). Each tab
 * keeps its own page selection, which is why `pageByTab` is keyed by tab and
 * not stored globally.
 */
export function DesignApp(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { connections, loading: connectionsLoading, reload, remove, makeDefault } =
    useConnectionProfiles();
  const toast = useToast();
  const confirm = useConfirm();
  // Read once: the stored session is the window's opening state, and reading it
  // again on a later render would fight whatever the user has done since. It is
  // filtered against the profiles below, once they have loaded.
  const [session] = useState(() => readSession([]));
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [pageByTab, setPageByTab] = useState<Record<string, PageId>>(session.pageByTab ?? {});
  const [restored, setRestored] = useState(false);
  const [view, setView] = useState<View>({ kind: "connections" });
  const [previousView, setPreviousView] = useState<View>({ kind: "tab" });

  // Window chrome, not per-tab state: see the note on Sidebar.
  const [navCollapsed, setNavCollapsed] = useState(session.navCollapsed ?? false);

  // The marker stays lit for as long as an update is pending: it is a state,
  // not a notification, and it clears itself when the update is taken or
  // skipped.
  const { available: updateAvailable, check: checkUpdate } = useUpdater();
  const [alertsRead, setAlertsRead] = useState(false);

  // Applied to the document, not to this tree: every board is drawn in absolute
  // px and the whole document is zoomed to the chosen size.
  const { setting: scaleSetting, fontSize, setSetting: setScale } = useUIScale();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  /*
   * The session names profiles, so it can only be restored once they have
   * loaded: a tab whose profile is gone must not reopen. Reopening on the
   * connection list would restore the tabs and then hide them, so a session
   * that names a tab reopens on it.
   */
  useEffect(() => {
    if (connectionsLoading || restored) return;
    setRestored(true);
    const known = connections.map((c) => c.key);
    const tabs = (session.openTabs ?? []).filter((key) => known.includes(key));
    if (tabs.length === 0) return;
    const active = session.activeTab != null && tabs.includes(session.activeTab)
      ? session.activeTab
      : tabs[0]!;
    setOpenTabs(tabs);
    setActiveTab(active);
    setView({ kind: "tab" });
  }, [connections, connectionsLoading, restored, session]);

  useEffect(() => {
    if (!restored) return;
    writeSession({ openTabs, activeTab, pageByTab, navCollapsed });
  }, [activeTab, navCollapsed, openTabs, pageByTab, restored]);

  const connection = connections.find((c) => c.key === activeTab) ?? null;
  const protocol = connection?.protocol ?? null;
  const page: PageId = (activeTab != null ? pageByTab[activeTab] : undefined) ?? "overview";

  const goto = useCallback(
    (next: View) => {
      setView((current) => {
        if (current.kind === "tab") setPreviousView(current);
        return next;
      });
    },
    [],
  );

  // ⌘K / Ctrl+K opens the palette from anywhere (9d); ⌘B collapses the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === "b") {
        e.preventDefault();
        setNavCollapsed((collapsed) => !collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openTab = useCallback((key: string) => {
    setOpenTabs((tabs) => (tabs.includes(key) ? tabs : [...tabs, key]));
    setActiveTab(key);
    setView({ kind: "tab" });
  }, []);

  const closeTab = (key: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== key);
      setActiveTab((current) => (current === key ? (next[0] ?? null) : current));
      if (next.length === 0) setView({ kind: "connections" });
      return next;
    });
  };

  /*
   * The tray menu's destination. A page only exists inside a tab, so a request
   * naming a connection opens or raises that tab first, and one that names
   * none lands in whichever tab is in front. With no tab to land in there is
   * nothing to show but the connection list.
   */
  const trayNavigate = useCallback(
    (to: TrayDestination) => {
      if (to.page === "settings") {
        goto({ kind: "settings" });
        return;
      }
      const key = to.connection !== "" ? to.connection : activeTab;
      if (to.page === "connections" || key == null) {
        goto({ kind: "connections" });
        return;
      }
      openTab(key);
      // The connections submenu sends no page: raising a tab must not cost the
      // user the page it was left on.
      if (to.page !== "") setPageByTab((byTab) => ({ ...byTab, [key]: to.page as PageId }));
    },
    [activeTab, goto, openTab],
  );

  useEffect(() => onTrayNavigate(trayNavigate), [trayNavigate]);

  /*
   * The other half of that conversation: the tray menu offers the active tab's
   * sidebar, and can only do so because the labels are reported to it. They
   * are resolved here, so a language change re-reports rather than leaving Go
   * holding the previous language's menu.
   */
  useEffect(() => {
    const pages =
      protocol == null
        ? []
        : pagesOf(protocol).map((id) => ({ id, label: t(labelOf(protocol, id)) }));
    void reportShellSession(activeTab ?? "", page, pages).catch(() => {
      // Off Wails there is no tray to tell.
    });
  }, [activeTab, i18n.language, page, protocol, t]);

  const deleteConnection = async (connection: Connection) => {
    const confirmed = await confirm({
      title: t("page.connections.deleteTitle"),
      description: t("page.connections.deleteDesc", { name: connection.name }),
      confirmLabel: t("page.connections.deleteAction"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await remove(connection.id);
      setOpenTabs((tabs) => tabs.filter((t) => t !== connection.key));
      setActiveTab((current) => (current === connection.key ? null : current));
      toast.success(t("page.connections.deleted", { name: connection.name }));
    } catch (error) {
      toast.error(t("page.connections.deleteFailed"), { description: String(error) });
    }
  };

  const promoteConnection = async (connection: Connection) => {
    try {
      await makeDefault(connection.id);
      toast.success(t("page.connections.defaultSet", { name: connection.name }));
    } catch (error) {
      toast.error(t("page.connections.defaultFailed"), { description: String(error) });
    }
  };

  const exportConfig = async () => {
    try {
      const path = await exportAllConfigToFile();
      if (path == null) return;
      toast.success(t("page.settings.data.exported"), { description: path });
    } catch (error) {
      toast.error(t("page.settings.data.exportFailed"), { description: String(error) });
    }
  };

  const importConfig = async () => {
    const confirmed = await confirm({
      title: t("page.settings.data.import"),
      description: t("page.settings.data.importDesc"),
      confirmLabel: t("page.settings.data.importConfirm"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const path = await importAllConfigFromFile();
      if (path == null) return;
      await reload();
      toast.success(t("page.settings.data.imported"), { description: path });
    } catch (error) {
      toast.error(t("page.settings.data.importFailed"), { description: String(error) });
    }
  };

  const selectPage = (next: PageId) => {
    if (activeTab == null) return;
    setPageByTab((byTab) => ({ ...byTab, [activeTab]: next }));
  };

  const onConnection = view.kind === "tab" && protocol != null;
  // The connection list is the home page, and a tab with no connection behind
  // it falls back to the same list, so the mark reads as selected there too.
  const atHome = view.kind === "connections" || (view.kind === "tab" && !onConnection);

  const sidebar =
    onConnection && protocol != null ? (
      <Sidebar
        protocol={protocol}
        active={pagesOf(protocol).includes(page) ? page : "overview"}
        collapsed={navCollapsed}
        onSelect={selectPage}
        onToggle={() => setNavCollapsed((collapsed) => !collapsed)}
      />
    ) : undefined;

  const content = (() => {
    switch (view.kind) {
      case "connections":
        return connections.length === 0 ? (
          <ConnectionsEmpty onNewConnection={() => setDialogOpen(true)} />
        ) : (
          <ConnectionsList
            connections={connections}
            onNewConnection={() => setDialogOpen(true)}
            onOpenTab={openTab}
            onDelete={(connection) => void deleteConnection(connection)}
            onSetDefault={(connection) => void promoteConnection(connection)}
            onImport={() => void importConfig()}
            onExport={() => void exportConfig()}
          />
        );
      case "settings":
        return (
          <Settings
            onBack={() => setView(previousView)}
            onOpenDoc={(doc) => setView({ kind: "doc", doc })}
            scale={{ setting: scaleSetting, fontSize, onChange: setScale }}
            initialSection={view.section}
          />
        );
      case "doc": {
        const Doc = DOCS[view.doc];
        return <Doc />;
      }
      case "split":
        return <SplitCompare onClose={() => setView({ kind: "tab" })} />;
      case "tab":
      default:
        if (protocol == null) {
          return connections.length === 0 ? (
            <ConnectionsEmpty onNewConnection={() => setDialogOpen(true)} />
          ) : (
            <ConnectionsList
              connections={connections}
              onNewConnection={() => setDialogOpen(true)}
              onOpenTab={openTab}
              onDelete={(connection) => void deleteConnection(connection)}
              onSetDefault={(connection) => void promoteConnection(connection)}
              onImport={() => void importConfig()}
              onExport={() => void exportConfig()}
            />
          );
        }
        return renderBoard(protocol, pagesOf(protocol).includes(page) ? page : "overview");
    }
  })();

  const online = connections.filter((c) => c.status === "online").length;

  /*
   * The page transition. Everything the key names already remounts the column
   * on its own -- a different board is a different component, a different tab
   * is a different connection -- so keying on it costs nothing the switch was
   * not already paying, and gives the change one fade to arrive on.
   */
  const viewKey = [
    view.kind,
    view.kind === "doc" ? view.doc : "",
    view.kind === "settings" ? "" : (activeTab ?? ""),
    onConnection ? page : "",
  ].join(":");

  const column = (
    <div key={viewKey} className="mqs-view" style={{ flex: 1, display: "flex", minWidth: 0 }}>
      {content}
    </div>
  );

  return (
    <AppShell
      titleBar={
        <TitleBar
          homeActive={atHome}
          splitActive={view.kind === "split"}
          dimmed={connections.length === 0}
          updateReady={updateAvailable != null}
          onHome={() => goto({ kind: "connections" })}
          onSearch={() => setPaletteOpen(true)}
          onRefresh={() => void checkUpdate()}
          onGithub={openGithub}
          notifications={alertsRead ? 0 : UNREAD_ALERTS}
          onNotifications={() => setNotificationsOpen((open) => !open)}
          onSettings={() => goto({ kind: "settings" })}
          onSplit={
            openTabs.length >= 2
              ? () =>
                  setView((current) =>
                    current.kind === "split" ? { kind: "tab" } : { kind: "split" },
                  )
              : undefined
          }
          tabs={
            <ConnectionTabs
              tabs={openTabs}
              connections={connections}
              /*
               * 3a / 3g keep the connection tab highlighted behind a global
               * view; the home page is the one that does not, because it is
               * itself a tab and two tabs cannot both be selected.
               */
              active={atHome ? null : activeTab}
              compare={
                view.kind === "split"
                  ? { label: t("shell.tabs.compare"), detail: "RMQ ⇄ Kafka" }
                  : null
              }
              onSelect={openTab}
              onClose={closeTab}
              onAdd={() => {
                goto({ kind: "connections" });
                setDialogOpen(true);
              }}
              onSplit={() =>
                setView((current) =>
                  current.kind === "split" ? { kind: "tab" } : { kind: "split" },
                )
              }
            />
          }
        />
      }
      sidebar={sidebar}
      overlays={
        <>
          <NewConnectionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
          <CommandPalette
            open={paletteOpen}
            query={paletteQuery}
            connections={connections}
            protocol={protocol}
            onQueryChange={setPaletteQuery}
            onOpenConnection={openTab}
            onOpenPage={selectPage}
            onNewConnection={() => {
              goto({ kind: "connections" });
              setDialogOpen(true);
            }}
            onOpenSettings={() => goto({ kind: "settings" })}
            onCheckUpdate={() => void checkUpdate()}
            onClose={() => setPaletteOpen(false)}
          />
          <NotificationCenter
            open={notificationsOpen}
            read={alertsRead}
            onClose={() => setNotificationsOpen(false)}
            onMarkAllRead={() => setAlertsRead(true)}
            onOpenAlertSettings={() => {
              setNotificationsOpen(false);
              goto({ kind: "settings", section: "message" });
            }}
          />
        </>
      }
    >
      {onConnection && connection != null ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>{column}</div>
          <TabStatusBar
            connection={connection.name}
            latency={connection.latency ?? "—"}
            tabCount={openTabs.length}
            onlineCount={online}
          />
        </div>
      ) : (
        column
      )}
    </AppShell>
  );
}
