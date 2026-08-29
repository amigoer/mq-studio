import { useCallback, useEffect, useState, type JSX } from "react";
import {
  AppShell,
  CommandPalette,
  ConnectionTabs,
  NotificationCenter,
  Sidebar,
  TabStatusBar,
  TitleBar,
} from "@/design/shell";
import { CONNECTIONS, DEFAULT_OPEN_TABS, type Connection } from "@/design/data/connections";
import { pagesOf, type PageId } from "@/design/data/protocols";
import { renderBoard } from "@/design/registry";
import { openExternal } from "@/api/platform";
import { useUIScale } from "@/hooks/useUIScale";
import { ConnectionsList } from "@/design/boards/connections/ConnectionsList";
import { ConnectionsEmpty } from "@/design/boards/connections/ConnectionsEmpty";
import { NewConnectionDialog } from "@/design/boards/connections/NewConnectionDialog";
import { Settings, type DocId } from "@/design/boards/settings/Settings";
import { SplitCompare } from "@/design/boards/split/SplitCompare";
import { CapabilityMatrix } from "@/design/boards/docs/CapabilityMatrix";
import { ReuseStrategy } from "@/design/boards/docs/ReuseStrategy";
import { NavModel } from "@/design/boards/docs/NavModel";

/** Global views sit beside the connection tabs rather than inside one. */
type View = { kind: "tab" } | { kind: "connections" } | { kind: "settings" } | { kind: "split" } | { kind: "doc"; doc: DocId };

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
  const [connections, setConnections] = useState<readonly Connection[]>(CONNECTIONS);
  const [openTabs, setOpenTabs] = useState<string[]>(DEFAULT_OPEN_TABS);
  const [activeTab, setActiveTab] = useState<string | null>(DEFAULT_OPEN_TABS[0] ?? null);
  const [pageByTab, setPageByTab] = useState<Record<string, PageId>>({});
  const [view, setView] = useState<View>({ kind: "connections" });
  const [previousView, setPreviousView] = useState<View>({ kind: "tab" });

  // Window chrome, not per-tab state: see the note on Sidebar.
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Applied to the document, not to this tree: every board is drawn in absolute
  // px and the whole document is zoomed to the chosen size.
  const { setting: scaleSetting, fontSize, setSetting: setScale } = useUIScale();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("order");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

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

  const openTab = (key: string) => {
    setOpenTabs((tabs) => (tabs.includes(key) ? tabs : [...tabs, key]));
    setActiveTab(key);
    setView({ kind: "tab" });
  };

  const closeTab = (key: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== key);
      setActiveTab((current) => (current === key ? (next[0] ?? null) : current));
      if (next.length === 0) setView({ kind: "connections" });
      return next;
    });
  };

  const deleteConnection = (key: string) => {
    setConnections((list) => list.filter((c) => c.key !== key));
    setOpenTabs((tabs) => tabs.filter((t) => t !== key));
    setActiveTab((current) => (current === key ? null : current));
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
            onDelete={deleteConnection}
          />
        );
      case "settings":
        return (
          <Settings
            onBack={() => setView(previousView)}
            onOpenDoc={(doc) => setView({ kind: "doc", doc })}
            scale={{ setting: scaleSetting, fontSize, onChange: setScale }}
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
              onDelete={deleteConnection}
            />
          );
        }
        return renderBoard(protocol, pagesOf(protocol).includes(page) ? page : "overview");
    }
  })();

  const online = connections.filter((c) => c.status === "online").length;

  return (
    <AppShell
      titleBar={
        <TitleBar
          homeActive={atHome}
          splitActive={view.kind === "split"}
          dimmed={connections.length === 0}
          updateReady
          onHome={() => goto({ kind: "connections" })}
          onSearch={() => setPaletteOpen(true)}
          onRefresh={() => undefined}
          onGithub={openGithub}
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
              /*
               * 3a / 3g keep the connection tab highlighted behind a global
               * view; the home page is the one that does not, because it is
               * itself a tab and two tabs cannot both be selected.
               */
              active={atHome ? null : activeTab}
              compare={view.kind === "split" ? { label: "对照", detail: "RMQ ⇄ Kafka" } : null}
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
            onQueryChange={setPaletteQuery}
            onClose={() => setPaletteOpen(false)}
          />
          <NotificationCenter
            open={notificationsOpen}
            onClose={() => setNotificationsOpen(false)}
          />
        </>
      }
    >
      {onConnection && connection != null ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>{content}</div>
          <TabStatusBar
            connection={connection.name}
            latency={connection.latency ?? "—"}
            tabCount={openTabs.length}
            onlineCount={online}
          />
        </div>
      ) : (
        content
      )}
    </AppShell>
  );
}
