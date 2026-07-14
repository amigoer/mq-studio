import { readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { BackendCall } from '../shared/bridge'
import { executeBackendCall } from './backend-operations'
import type { DaemonSupervisor } from './daemon-supervisor'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const allowedExternalHosts = new Set(['github.com', 'api.github.com'])

export async function openAllowedExternal(value: unknown): Promise<void> {
  if (typeof value !== 'string') throw new Error('外部链接无效')
  const url = new URL(value)
  if (url.protocol !== 'https:' || !allowedExternalHosts.has(url.hostname)) {
    throw new Error('不允许打开此外部链接')
  }
  await shell.openExternal(url.toString())
}

function trustedSender(url: string): boolean {
  return (
    url.startsWith('app://rocket-leaf/') ||
    url.startsWith('http://localhost:') ||
    url.startsWith('http://127.0.0.1:')
  )
}

export function registerIPC(window: BrowserWindow, supervisor: DaemonSupervisor): void {
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
    ipcMain.handle(channel, (event, ...args) => {
      const senderURL = event.senderFrame?.url ?? event.sender.getURL()
      if (!trustedSender(senderURL)) throw new Error('拒绝来自未知页面的 IPC 调用')
      return listener(event, ...args)
    })
  }

  handle('window:minimize', () => window.minimize())
  handle('window:toggle-maximize', () =>
    window.isMaximized() ? window.unmaximize() : window.maximize(),
  )
  handle('window:close', () => window.close())
  handle('window:is-maximized', () => window.isMaximized())
  handle('daemon:state', () => supervisor.state)
  handle('backend:call', (_event, call: BackendCall) => executeBackendCall(supervisor, call))

  handle('shell:open-external', async (_event, value: unknown) => {
    await openAllowedExternal(value)
  })

  handle('dialogs:export-config', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(window, {
      title: '导出 Rocket Leaf 配置',
      defaultPath: `rocket-leaf-config-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    const response = await supervisor.request<{ content: string }>('GET', '/v1/settings/export')
    await writeFile(result.filePath, response.content, { encoding: 'utf8', mode: 0o600 })
    return result.filePath
  })

  handle('dialogs:import-config', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '导入 Rocket Leaf 配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return null
    const content = await readFile(filePath, 'utf8')
    await supervisor.request('POST', '/v1/settings/import', { content })
    return filePath
  })

  handle('updater:check', () => autoUpdater.checkForUpdates())
  handle('updater:download', () => autoUpdater.downloadUpdate())
  handle('updater:install', () => autoUpdater.quitAndInstall())
}

export function unregisterIPC(): void {
  for (const channel of [
    'window:minimize',
    'window:toggle-maximize',
    'window:close',
    'window:is-maximized',
    'daemon:state',
    'backend:call',
    'shell:open-external',
    'dialogs:export-config',
    'dialogs:import-config',
    'updater:check',
    'updater:download',
    'updater:install',
  ])
    ipcMain.removeHandler(channel)
}
