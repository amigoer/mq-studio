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

  // ⌘K / Ctrl+K opens the palette from anywhere (9d).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
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

  const sidebar =
    onConnection && protocol != null ? (
      <Sidebar
        protocol={protocol}
        active={pagesOf(protocol).includes(page) ? page : "overview"}
        onSelect={selectPage}
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
          connectionsActive={view.kind === "connections"}
          splitActive={view.kind === "split"}
          dimmed={connections.length === 0}
          updateReady
          onSearch={() => setPaletteOpen(true)}
          onConnections={() => goto({ kind: "connections" })}
          onRefresh={() => undefined}
          onGithub={() => window.open(GITHUB_URL, "_blank", "noopener")}
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
              /* 8a / 3a / 3g keep the connection tab highlighted behind a global view. */
              active={activeTab}
              compare={view.kind === "split" ? { label: "⊞ 对照", detail: "RMQ ⇄ Kafka" } : null}
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
