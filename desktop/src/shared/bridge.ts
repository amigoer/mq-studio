export type BackendOperation =
  | 'connections.list'
  | 'connections.add'
  | 'connections.update'
  | 'connections.remove'
  | 'connections.connect'
  | 'connections.disconnect'
  | 'connections.connectDefault'
  | 'connections.setDefault'
  | 'connections.test'
  | 'settings.get'
  | 'settings.update'
  | 'settings.reset'
  | 'settings.clearCache'
  | 'cluster.info'
  | 'cluster.summary'
  | 'cluster.brokers'
  | 'cluster.brokerDetail'
  | 'topics.list'
  | 'topics.listAll'
  | 'topics.detail'
  | 'topics.stats'
  | 'topics.create'
  | 'topics.update'
  | 'topics.remove'
  | 'consumers.list'
  | 'consumers.detail'
  | 'consumers.stats'
  | 'consumers.create'
  | 'consumers.update'
  | 'consumers.remove'
  | 'consumers.resetOffset'
  | 'messages.query'
  | 'messages.byId'
  | 'messages.track'
  | 'messages.dlq'
  | 'messages.retry'
  | 'messages.resend'
  | 'messages.send'
  | 'acl.enabled'
  | 'acl.version'
  | 'acl.updateAccess'
  | 'acl.deleteAccess'
  | 'acl.updateWhiteAddrs'

export interface BackendCall {
  operation: BackendOperation
  payload?: Record<string, unknown>
}

export type DaemonState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'

export interface RocketLeafBridge {
  platform: NodeJS.Platform
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChange(listener: (maximized: boolean) => void): () => void
    /** Sync native window chrome with renderer light/dark appearance. */
    setAppearance(dark: boolean): Promise<void>
  }
  shell: { openExternal(url: string): Promise<void> }
  dialogs: {
    exportConfig(): Promise<string | null>
    importConfig(): Promise<string | null>
  }
  updater: {
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
  }
  daemon: {
    state(): Promise<DaemonState>
    onStateChange(listener: (state: DaemonState) => void): () => void
  }
  backend: { call<T>(call: BackendCall): Promise<T> }
}
