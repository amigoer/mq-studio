import { useEffect, useState } from "react";
import type React from "react";
import { Toaster } from "sonner";
import { TitleBar } from "@/layout/TitleBar";
import { Sidebar, type NavId } from "@/layout/Sidebar";
import { OverviewPage } from "@/pages/OverviewPage";
import { TopicsPage } from "@/pages/TopicsPage";
import { ConsumersPage } from "@/pages/ConsumersPage";
import { MessagesPage } from "@/pages/MessagesPage";
import { ProducerPage } from "@/pages/ProducerPage";
import { ClusterPage } from "@/pages/ClusterPage";
import { AlertsPage } from "@/pages/AlertsPage";
import { AclPage } from "@/pages/AclPage";
import { ConnectionsPage } from "@/pages/ConnectionsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { EmptyStatePage } from "@/pages/EmptyStatePage";
import { PageTransition } from "@/components/PageTransition";
import { useConnections } from "@/hooks/useConnections";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { onTrayNavigate } from "@/api/platform";

function App(): React.ReactElement {
  const [activeNav, setActiveNav] = useState<NavId>("home");
  const { active: activeConn, activeKey } = useConnections();
  const { unseen: updateUnseen, markSeen: markUpdateSeen } = useUpdateCheck();
  const hasConnected = activeConn != null;

  // Settings is where the update is shown, so being there counts as having
  // seen the marker — including when the check lands while it is already open.
  useEffect(() => {
    if (activeNav === "settings") markUpdateSeen();
  }, [activeNav, updateUnseen, markUpdateSeen]);

  // The tray menu jumps straight to a page; Go raises the window first.
  useEffect(
    () => onTrayNavigate((target) => setActiveNav(target as NavId)),
    [],
  );

  const gated =
    !hasConnected &&
    activeNav !== "connections" &&
    activeNav !== "settings" &&
    activeNav !== "home";

  // Force-remount the current page on cluster switch so filters, selection, and in-flight results cannot leak across clusters.
  const contentKey = gated
    ? `empty-${activeNav}-${activeKey}`
    : `${activeNav}-${activeKey}`;

  const renderContent = () => {
    if (gated) {
      return (
        <EmptyStatePage onAddConnection={() => setActiveNav("connections")} />
      );
    }
    switch (activeNav) {
      case "home":
        return <OverviewPage onNavigate={setActiveNav} />;
      case "topics":
        return <TopicsPage onNavigate={setActiveNav} />;
      case "consumers":
        return <ConsumersPage onNavigate={setActiveNav} />;
      case "messages":
        return <MessagesPage onNavigate={setActiveNav} />;
      case "producer":
        return <ProducerPage onNavigate={setActiveNav} />;
      case "cluster":
        return <ClusterPage onNavigate={setActiveNav} />;
      case "alerts":
        return <AlertsPage onNavigate={setActiveNav} />;
      case "acl":
        return <AclPage onNavigate={setActiveNav} />;
      case "connections":
        return <ConnectionsPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <OverviewPage onNavigate={setActiveNav} />;
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar
        connected={activeConn?.name ?? null}
        onOpenConnections={() => setActiveNav("connections")}
      />
      <div className="flex min-h-0 flex-1 bg-background">
        <Sidebar
          active={activeNav}
          onSelect={setActiveNav}
          dotIds={updateUnseen ? ["settings"] : []}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          <PageTransition transitionKey={contentKey} variant="page">
            {renderContent()}
          </PageTransition>
        </main>
      </div>
      <Toaster
        position="top-center"
        closeButton
        toastOptions={{
          className: "mqs-toast",
        }}
        style={{ "--width": "360px" } as React.CSSProperties}
      />
    </div>
  );
}

export default App;
