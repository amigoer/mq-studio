import { contextBridge, ipcRenderer } from 'electron'
import type { BackendCall, DaemonState, RocketLeafBridge } from '../shared/bridge'

const bridge: RocketLeafBridge = {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    },
    setAppearance: (dark) => ipcRenderer.invoke('window:set-appearance', dark),
  },
  shell: { openExternal: (url) => ipcRenderer.invoke('shell:open-external', url) },
  dialogs: {
    exportConfig: () => ipcRenderer.invoke('dialogs:export-config'),
    importConfig: () => ipcRenderer.invoke('dialogs:import-config'),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
  },
  daemon: {
    state: () => ipcRenderer.invoke('daemon:state'),
    onStateChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: DaemonState) => listener(state)
      ipcRenderer.on('daemon:state-changed', handler)
      return () => ipcRenderer.removeListener('daemon:state-changed', handler)
    },
  },
  backend: {
    call: <T>(call: BackendCall) => ipcRenderer.invoke('backend:call', call) as Promise<T>,
  },
}

contextBridge.exposeInMainWorld('rocketLeaf', bridge)
