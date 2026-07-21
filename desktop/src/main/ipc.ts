import { stat, readFile, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { AppInfo, BackendCall, UpdateCheckResult } from '../shared/bridge'
import { executeBackendCall } from './operations'
import { MAX_IMPORT_BYTES, type DaemonSupervisor } from './daemon-supervisor'
import { isReleaseInstall } from './release-install'
import { checkLatestRelease } from './update-check'

const allowedExternalHosts = new Set(['github.com', 'api.github.com'])

export async function openAllowedExternal(value: unknown): Promise<void> {
  if (typeof value !== 'string') throw new Error('invalid external link')
  const url = new URL(value)
  if (url.protocol !== 'https:' || !allowedExternalHosts.has(url.hostname)) {
    throw new Error('opening this external link is not allowed')
  }
  await shell.openExternal(url.toString())
}

function trustedSender(url: string): boolean {
  if (url.startsWith('app://rocket-leaf/')) return true
  const devURL = process.env.ELECTRON_RENDERER_URL
  if (devURL && (url === devURL || url.startsWith(`${devURL}/`) || url.startsWith(devURL))) {
    return true
  }
  // electron-vite may load with trailing slash differences or query-less origin.
  // Temporary macOS .app bundles look packaged; still allow local Vite origins when
  // ELECTRON_RENDERER_URL is set or when not a real release install.
  if (devURL || !isReleaseInstall()) {
    try {
      const parsed = new URL(url)
      if (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      ) {
        // Only accept common Vite/electron-vite dev ports, not arbitrary local services.
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
        const allowedPorts = new Set(['5173', '5174', '4173', '3000', '8080'])
        if (devURL) {
          try {
            allowedPorts.add(new URL(devURL).port || '5173')
          } catch {
            /* ignore */
          }
        }
        return allowedPorts.has(port)
      }
    } catch {
      return false
    }
  }
  return false
}

export function registerIPC(
  window: BrowserWindow,
  supervisor: DaemonSupervisor,
  options?: { onAppearanceChange?: (dark: boolean) => void },
): void {
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
    ipcMain.handle(channel, (event, ...args) => {
      const senderURL = event.senderFrame?.url ?? event.sender.getURL()
      if (!trustedSender(senderURL)) throw new Error('IPC call from untrusted page rejected')
      return listener(event, ...args)
    })
  }

  handle('app:get-info', (): AppInfo => ({ version: app.getVersion() }))
  handle('window:minimize', () => window.minimize())
  handle('window:toggle-maximize', () =>
    window.isMaximized() ? window.unmaximize() : window.maximize(),
  )
  handle('window:close', () => window.close())
  handle('window:is-maximized', () => window.isMaximized())
  handle('window:set-appearance', (_event, dark: unknown) => {
    options?.onAppearanceChange?.(Boolean(dark))
  })
  handle('daemon:state', () => supervisor.state)
  handle('backend:call', (_event, call: BackendCall) => executeBackendCall(supervisor, call))

  handle('shell:open-external', async (_event, value: unknown) => {
    await openAllowedExternal(value)
  })

  handle('dialogs:export-config', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(window, {
      title: 'Export Rocket Leaf config',
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
      title: 'Import Rocket Leaf config',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return null
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('please select a valid config file')
    if (info.size > MAX_IMPORT_BYTES) {
      throw new Error(`config file too large (limit ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)} MB)`)
    }
    const content = await readFile(filePath, 'utf8')
    await supervisor.request('POST', '/v1/settings/import', { content })
    return filePath
  })

  handle(
    'updater:check',
    (): Promise<UpdateCheckResult> => checkLatestRelease(app.getVersion()),
  )
}

export function unregisterIPC(): void {
  for (const channel of [
    'app:get-info',
    'window:minimize',
    'window:toggle-maximize',
    'window:close',
    'window:is-maximized',
    'window:set-appearance',
    'daemon:state',
    'backend:call',
    'shell:open-external',
    'dialogs:export-config',
    'dialogs:import-config',
    'updater:check',
  ])
    ipcMain.removeHandler(channel)
}
