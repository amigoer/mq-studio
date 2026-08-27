import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SettingsProvider } from '@/hooks/useSettings'
import { ConnectionsProvider } from '@/hooks/useConnections'
import { CapabilitiesProvider } from '@/mq/capabilities'
import '@/mq/rocketmq'
import { OverviewProvider } from '@/hooks/useOverview'
import { AlertsProvider } from '@/hooks/useAlerts'
import { UpdateCheckProvider } from '@/hooks/useUpdateCheck'
import { bootstrapUIPrefs } from '@/hooks/useUIPrefs'
import '@/i18n'
import './index.css'

bootstrapUIPrefs()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <ConnectionsProvider>
        <CapabilitiesProvider>
          <OverviewProvider>
          <AlertsProvider>
            <UpdateCheckProvider>
              <App />
            </UpdateCheckProvider>
          </AlertsProvider>
          </OverviewProvider>
        </CapabilitiesProvider>
      </ConnectionsProvider>
    </SettingsProvider>
  </React.StrictMode>,
)
