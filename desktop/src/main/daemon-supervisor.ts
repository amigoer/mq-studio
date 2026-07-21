import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import type { DaemonState } from '../shared/bridge'
import { isReleaseInstall } from './release-install'

interface ReadyMessage {
  protocolVersion: number
  port: number
  pid: number
  appVersion: string
}

interface APIError {
  code?: string
  message?: string
  requestId?: string
}

const PROTOCOL_VERSION = 1
const START_TIMEOUT_MS = 10_000
// Daemon requestTimeoutMs caps a single RocketMQ call; an aggregated request
// may issue multiple calls, so main process uses a looser end-to-end safety limit.
const REQUEST_TIMEOUT_MS = 6 * 60_000
const RESTART_DELAYS = [1_000, 2_000, 5_000]
const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code = 'BACKEND_ERROR',
    readonly requestId?: string,
  ) {
    super(message)
  }
}

export class DaemonSupervisor extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: ReadyMessage | null = null
  private token = ''
  private stopping = false
  private restartCount = 0
  private currentState: DaemonState = 'stopped'
  private startPromise: Promise<void> | null = null

  get state(): DaemonState {
    return this.currentState
  }

  async start(): Promise<void> {
    if (this.ready && this.child) return
    if (this.startPromise) return this.startPromise
    this.stopping = false
    // Manual start/retry clears the auto-restart circuit breaker.
    this.restartCount = 0
    this.setState('starting')
    this.startPromise = this.spawnOnce()
      .then(() => {
        this.restartCount = 0
      })
      .catch((error) => {
        this.child = null
        this.ready = null
        this.token = ''
        this.setState('failed')
        throw error
      })
      .finally(() => {
        this.startPromise = null
      })
    return this.startPromise
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) {
      this.setState('stopped')
      return
    }
    try {
      await this.request('POST', '/v1/shutdown')
    } catch {
      try {
        child.stdin.end()
      } catch {
        /* ignore */
      }
    }
    await Promise.race([
      new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ])
    if (child.exitCode === null) child.kill('SIGKILL')
    this.child = null
    this.ready = null
    this.token = ''
    this.setState('stopped')
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.ready || !this.token) throw new BackendError('backend service is not ready', 'BACKEND_NOT_READY')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`http://127.0.0.1:${this.ready.port}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'X-Request-ID': randomBytes(8).toString('hex'),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as APIError
        throw new BackendError(
          error.message ?? `backend request failed (${response.status})`,
          error.code,
          error.requestId,
        )
      }
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  }

  private async spawnOnce(): Promise<void> {
    this.token = randomBytes(32).toString('base64url')
    const launch = this.resolveLaunch()
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ROCKET_LEAF_PARENT_PID: String(process.pid) },
    })
    this.child = child
    child.stdin.write(`${JSON.stringify({ token: this.token })}\n`)
    child.stderr.on('data', (chunk: Buffer) =>
      console.error(`[rocket-leafd] ${chunk.toString().trimEnd()}`),
    )

    let ready: ReadyMessage
    try {
      ready = await new Promise<ReadyMessage>((resolveReady, rejectReady) => {
        let settled = false
        const lines = createInterface({ input: child.stdout })
        let timeout: ReturnType<typeof setTimeout> | null = null
        let fail = (_error: Error): void => undefined
        const exitedBeforeReady = (code: number | null) =>
          fail(new Error(`backend service exited before ready (${code ?? 'unknown'})`))
        const cleanup = () => {
          if (timeout) clearTimeout(timeout)
          lines.close()
          child.removeListener('error', fail)
          child.removeListener('exit', exitedBeforeReady)
        }
        fail = (error: Error) => {
          if (settled) return
          settled = true
          cleanup()
          rejectReady(error)
        }
        timeout = setTimeout(() => fail(new Error('backend service start timed out')), START_TIMEOUT_MS)
        child.once('error', fail)
        child.once('exit', exitedBeforeReady)
        lines.once('line', (line) => {
          try {
            const message = JSON.parse(line) as ReadyMessage
            if (message.protocolVersion !== PROTOCOL_VERSION) {
              throw new Error(
                `backend protocol version mismatch (expected ${PROTOCOL_VERSION}, got ${String(message.protocolVersion)})`,
              )
            }
            if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
              throw new Error(`invalid backend port: ${String(message.port)}`)
            }
            const expectedVersion = app.getVersion()
            const daemonVersion =
              typeof message.appVersion === 'string' ? message.appVersion.trim() : ''
            if (!daemonVersion) {
              if (isReleaseInstall()) {
                throw new Error('backend did not report an application version')
              }
              console.warn('[daemon] backend did not report an application version')
            } else if (daemonVersion !== expectedVersion) {
              if (isReleaseInstall()) {
                throw new Error(
                  `backend version mismatch (desktop=${expectedVersion}, daemon=${daemonVersion})`,
                )
              }
              console.warn(
                `[daemon] version mismatch: desktop=${expectedVersion} daemon=${daemonVersion} (warning only; not blocking start)`,
              )
            }
            if (settled) return
            settled = true
            cleanup()
            resolveReady(message)
          } catch (error) {
            fail(error instanceof Error ? error : new Error('invalid backend ready message'))
          }
        })
      })
    } catch (error) {
      await this.terminateChild(child)
      if (this.child === child) this.child = null
      throw error
    }

    this.ready = ready
    this.restartCount = 0
    this.setState('ready')
    child.once('exit', () => {
      if (this.child === child) {
        this.child = null
        this.ready = null
        this.token = ''
      }
      if (!this.stopping) void this.restart()
    })
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    try {
      child.stdin.end()
    } catch {
      /* ignore */
    }
    if (child.exitCode !== null) return
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
    try {
      child.kill()
    } catch {
      return
    }
    await Promise.race([
      exited,
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
    ])
    if (child.exitCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      await Promise.race([
        exited,
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
      ])
    }
  }

  private async restart(): Promise<void> {
    if (this.restartCount >= RESTART_DELAYS.length) {
      this.setState('failed')
      this.emit('failed', new Error('backend service kept exiting; auto-restart stopped'))
      return
    }
    this.setState('restarting')
    const delay = RESTART_DELAYS[this.restartCount++]!
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))
    if (this.stopping) return
    try {
      await this.spawnOnce()
    } catch (error) {
      console.error('[daemon] restart failed', error)
      await this.restart()
    }
  }

  private resolveLaunch(): { command: string; args: string[]; cwd?: string } {
    const executable = process.platform === 'win32' ? 'rocket-leafd.exe' : 'rocket-leafd'
    const platformDir =
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
    const archDir = process.arch === 'arm64' ? 'arm64' : 'x64'
    const appPath = app.getAppPath()

    // Explicit override always wins (make run / CI / scripts).
    if (process.env.ROCKET_LEAF_DAEMON_PATH) {
      const override = resolve(process.env.ROCKET_LEAF_DAEMON_PATH)
      if (!existsSync(override)) {
        throw new Error(`ROCKET_LEAF_DAEMON_PATH does not exist: ${override}`)
      }
      return { command: override, args: [] }
    }

    // Never trust app.isPackaged alone: temporary macOS .app bundles used for
    // dev icons look "packaged" but do not ship resources/bin/rocket-leafd.
    const candidates = [
      // Real electron-builder install: extraResources → Contents/Resources/bin/
      join(process.resourcesPath, 'bin', executable),
      // Repo layout from scripts/build-daemon.sh (appPath ≈ desktop/)
      join(appPath, 'resources', 'bin', platformDir, archDir, executable),
      // appPath ≈ desktop/out or similar nested paths
      join(appPath, '..', 'resources', 'bin', platformDir, archDir, executable),
      join(appPath, '..', 'desktop', 'resources', 'bin', platformDir, archDir, executable),
      // Optional local daemon/dist build
      join(appPath, '..', 'daemon', 'dist', executable),
      join(appPath, '..', '..', 'daemon', 'dist', executable),
    ]

    for (const candidate of candidates) {
      if (existsSync(candidate)) return { command: resolve(candidate), args: [] }
    }

    // Last resort for local development: go run (requires Go on PATH).
    const daemonRoots = [resolve(appPath, '..', 'daemon'), resolve(appPath, '..', '..', 'daemon')]
    for (const daemonRoot of daemonRoots) {
      if (existsSync(join(daemonRoot, 'cmd', 'rocket-leafd'))) {
        return { command: 'go', args: ['run', './cmd/rocket-leafd'], cwd: daemonRoot }
      }
    }

    throw new Error(
      `rocket-leafd executable not found. Run make build-daemon first, or set ROCKET_LEAF_DAEMON_PATH.\nTried:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
    )
  }

  private setState(state: DaemonState): void {
    if (state === this.currentState) return
    this.currentState = state
    this.emit('state', state)
  }
}

export { MAX_IMPORT_BYTES }
