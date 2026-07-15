import { stat, readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { BackendCall, UpdateCheckResult } from '../shared/bridge'
import { executeBackendCall } from './operations'
import { MAX_IMPORT_BYTES, type DaemonSupervisor } from './daemon-supervisor'
import { isReleaseInstall } from './release-install'
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
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('请选择有效的配置文件')
    if (info.size > MAX_IMPORT_BYTES) {
      throw new Error(`配置文件过大（上限 ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)} MB）`)
    }
    const content = await readFile(filePath, 'utf8')
    await supervisor.request('POST', '/v1/settings/import', { content })
    return filePath
  })

  handle('updater:check', async () => {
    if (!isReleaseInstall()) {
      throw new Error('当前为开发/本地运行环境，不支持应用内更新检查')
    }
    const result = await autoUpdater.checkForUpdates()
    const response: UpdateCheckResult = {
      updateAvailable: result?.isUpdateAvailable ?? false,
      version: result?.updateInfo.version,
    }
    return response
  })
  handle('updater:download', async () => {
    if (!isReleaseInstall()) throw new Error('当前环境不支持下载更新')
    return autoUpdater.downloadUpdate()
  })
  handle('updater:install', async () => {
    if (!isReleaseInstall()) throw new Error('当前环境不支持安装更新')
    autoUpdater.quitAndInstall()
  })
}

export function unregisterIPC(): void {
  for (const channel of [
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
    'updater:download',
    'updater:install',
  ])
    ipcMain.removeHandler(channel)
}
