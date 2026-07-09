import { useState } from 'react'
import type React from 'react'
import { Toaster } from 'sonner'
import { TitleBar } from '@/redesign/TitleBar'
import { Sidebar, type NavId } from '@/redesign/Sidebar'
import { OverviewScreen } from '@/redesign/screens/OverviewScreen'
import { TopicsScreen } from '@/redesign/screens/TopicsScreen'
import { ConsumersScreen } from '@/redesign/screens/ConsumersScreen'
import { MessagesScreen } from '@/redesign/screens/MessagesScreen'
import { ProducerScreen } from '@/redesign/screens/ProducerScreen'
import { ClusterScreen } from '@/redesign/screens/ClusterScreen'
import { AlertsScreen } from '@/redesign/screens/AlertsScreen'
import { AclScreen } from '@/redesign/screens/AclScreen'
import { ConnectionsScreen } from '@/redesign/screens/ConnectionsScreen'
import { SettingsScreen } from '@/redesign/screens/SettingsScreen'
import { EmptyStateScreen } from '@/redesign/screens/EmptyStateScreen'
import { PageTransition } from '@/components/PageTransition'
import { useConnections } from '@/hooks/useConnections'

function App(): React.ReactElement {
  const [activeNav, setActiveNav] = useState<NavId>('home')
  const { list: connections } = useConnections()
  const activeConn = connections.find((c) => c.status === 'online') ?? null
  const hasConnected = activeConn != null

  const gated =
    !hasConnected && activeNav !== 'connections' && activeNav !== 'settings' && activeNav !== 'home'

  const contentKey = gated ? `empty-${activeNav}` : activeNav

  const renderContent = () => {
    if (gated) {
      return <EmptyStateScreen onAddConnection={() => setActiveNav('connections')} />
    }
    switch (activeNav) {
      case 'home':
        return <OverviewScreen onNavigate={setActiveNav} />
      case 'topics':
        return <TopicsScreen />
      case 'consumers':
        return <ConsumersScreen />
      case 'messages':
        return <MessagesScreen />
      case 'producer':
        return <ProducerScreen />
      case 'cluster':
        return <ClusterScreen />
      case 'alerts':
        return <AlertsScreen onNavigate={setActiveNav} />
      case 'acl':
        return <AclScreen />
      case 'connections':
        return <ConnectionsScreen />
      case 'settings':
        return <SettingsScreen />
      default:
        return <OverviewScreen onNavigate={setActiveNav} />
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar
        connected={activeConn?.name ?? null}
        onOpenConnections={() => setActiveNav('connections')}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          active={activeNav}
          onSelect={setActiveNav}
          disabledIds={
            !hasConnected
              ? ['topics', 'consumers', 'messages', 'producer', 'cluster', 'alerts', 'acl']
              : []
          }
        />
        <main className="rl-app-bg min-h-0 min-w-0 flex-1 overflow-hidden">
          <PageTransition transitionKey={contentKey} variant="page">
            {renderContent()}
          </PageTransition>
        </main>
      </div>
      <Toaster
        position="top-center"
        closeButton
        toastOptions={{
          className: 'rl-toast',
        }}
        style={{ '--width': '360px' } as React.CSSProperties}
      />
    </div>
  )
}

export default App
