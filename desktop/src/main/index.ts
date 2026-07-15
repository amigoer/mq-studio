import { existsSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, nativeImage, net, protocol } from 'electron'
import electronUpdater from 'electron-updater'
import { DaemonSupervisor } from './daemon-supervisor'
import { openAllowedExternal, registerIPC, unregisterIPC } from './ipc'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const APPLICATION_NAME = 'Rocket Leaf'
app.setName(APPLICATION_NAME)

const supervisor = new DaemonSupervisor()
const { autoUpdater } = electronUpdater
let mainWindow: BrowserWindow | null = null
let shutdownStarted = false

function applicationIconPath(): string | undefined {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  return existsSync(iconPath) ? iconPath : undefined
}

function configureApplicationIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const iconPath = applicationIconPath()
  if (!iconPath) return
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) app.dock.setIcon(icon)
}

function registerApplicationProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    const requestedPath =
      decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
    const normalized = normalize(requestedPath)
    let filePath = join(rendererRoot, normalized)
    if (relative(rendererRoot, filePath).startsWith('..') || !existsSync(filePath))
      filePath = join(rendererRoot, 'index.html')
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow(): BrowserWindow {
  const mac = process.platform === 'darwin'
  const window = new BrowserWindow({
    title: APPLICATION_NAME,
    width: 1152,
    height: 780,
    minWidth: 1024,
    minHeight: 750,
    show: false,
    backgroundColor: '#f7f8fa',
    icon: applicationIconPath(),
    frame: mac,
    titleBarStyle: mac ? 'hidden' : 'default',
    trafficLightPosition: mac ? { x: 16, y: 17 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openAllowedExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('app://rocket-leaf/') ||
      url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'never://')
    if (!allowed) event.preventDefault()
  })
  const notifyMaximized = () =>
    window.webContents.send('window:maximized-changed', window.isMaximized())
  window.on('maximize', notifyMaximized)
  window.on('unmaximize', notifyMaximized)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadURL('app://rocket-leaf/index.html')
  return window
}

function configureUpdater(window: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('error', (error) => console.error('[updater]', error))
  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox(window, {
      type: 'info',
      title: '发现新版本',
      message: `Rocket Leaf ${info.version} 已发布`,
      detail: '是否现在下载更新？下载完成后会再次询问是否重启。',
      buttons: ['下载更新', '稍后提醒'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0) await autoUpdater.downloadUpdate()
  })
  autoUpdater.on('update-downloaded', async (info) => {
    const result = await dialog.showMessageBox(window, {
      type: 'info',
      title: '更新已下载',
      message: `Rocket Leaf ${info.version} 已准备完成`,
      detail: '是否立即重启并安装更新？',
      buttons: ['立即重启', '下次启动时安装'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0) autoUpdater.quitAndInstall()
  })
  setTimeout(
    () => void autoUpdater.checkForUpdates().catch((error) => console.error('[updater]', error)),
    3_000,
  )
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function showDaemonError(
  window: BrowserWindow | null,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  const parent = window && !window.isDestroyed() ? window : null
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

async function ensureDaemonReady(window: BrowserWindow | null): Promise<boolean> {
  try {
    await supervisor.start()
    return true
  } catch (error) {
    console.error('[daemon] 启动失败', error)
    const result = await showDaemonError(window, {
      type: 'error',
      title: '后端服务启动失败',
      message: 'Rocket Leaf 本地守护进程未能启动',
      detail: `${formatError(error)}\n\n可重试启动，或退出应用。`,
      buttons: ['重试', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (result.response === 0) return ensureDaemonReady(window)
    app.quit()
    return false
  }
}

app.whenReady().then(async () => {
  registerApplicationProtocol()
  configureApplicationIcon()

  const started = await ensureDaemonReady(null)
  if (!started) return

  mainWindow = createWindow()
  registerIPC(mainWindow, supervisor)
  supervisor.on('state', (state) => mainWindow?.webContents.send('daemon:state-changed', state))
  supervisor.on('failed', async (error: unknown) => {
    const result = await showDaemonError(mainWindow, {
      type: 'error',
      title: '后端服务已停止',
      message: '本地守护进程反复退出，已停止自动恢复',
      detail: formatError(error),
      buttons: ['重新启动后端', '忽略'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (result.response === 0) void ensureDaemonReady(mainWindow)
  })
  // Temporary macOS .app bundles used for local icons also report isPackaged=true.
  // Only enable updater when the real install layout is present.
  if (app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    configureUpdater(mainWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      unregisterIPC()
      registerIPC(mainWindow, supervisor)
    }
  })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (shutdownStarted) return
  event.preventDefault()
  shutdownStarted = true
  void supervisor.stop().finally(() => {
    unregisterIPC()
    app.quit()
  })
})
