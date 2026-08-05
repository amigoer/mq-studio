import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SettingsProvider } from '@/hooks/useSettings'
import { ConnectionsProvider } from '@/hooks/useConnections'
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
        <OverviewProvider>
          <AlertsProvider>
            <UpdateCheckProvider>
              <App />
            </UpdateCheckProvider>
          </AlertsProvider>
        </OverviewProvider>
      </ConnectionsProvider>
    </SettingsProvider>
  </React.StrictMode>,
)
