import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import type { DaemonState } from '../shared/bridge'

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
const RESTART_DELAYS = [1_000, 2_000, 5_000]

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

  get state(): DaemonState {
    return this.currentState
  }

  async start(): Promise<void> {
    if (this.child || this.currentState === 'starting') return
    this.stopping = false
    this.setState('starting')
    try {
      await this.spawnOnce()
    } catch (error) {
      this.child = null
      this.ready = null
      this.token = ''
      this.setState('failed')
      throw error
    }
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
      child.stdin.end()
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
    if (!this.ready || !this.token) throw new BackendError('后端服务尚未就绪', 'BACKEND_NOT_READY')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
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
          error.message ?? `后端请求失败（${response.status}）`,
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

    const ready = await new Promise<ReadyMessage>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error('后端服务启动超时')), START_TIMEOUT_MS)
      const lines = createInterface({ input: child.stdout })
      const fail = (error: Error) => {
        clearTimeout(timeout)
        lines.close()
        rejectReady(error)
      }
      const exitedBeforeReady = (code: number | null) =>
        fail(new Error(`后端服务在就绪前退出（${code ?? 'unknown'}）`))
      child.once('error', fail)
      child.once('exit', exitedBeforeReady)
      lines.once('line', (line) => {
        try {
          const message = JSON.parse(line) as ReadyMessage
          if (
            message.protocolVersion !== PROTOCOL_VERSION ||
            !Number.isInteger(message.port) ||
            message.appVersion !== app.getVersion()
          ) {
            throw new Error('后端协议版本或端口无效')
          }
          clearTimeout(timeout)
          child.removeListener('error', fail)
          child.removeListener('exit', exitedBeforeReady)
          resolveReady(message)
        } catch (error) {
          fail(error instanceof Error ? error : new Error('后端就绪消息无效'))
        }
      })
    })

    this.ready = ready
    this.setState('ready')
    child.once('exit', () => {
      if (this.child === child) {
        this.child = null
        this.ready = null
      }
      if (!this.stopping) void this.restart()
    })
  }

  private async restart(): Promise<void> {
    if (this.restartCount >= RESTART_DELAYS.length) {
      this.setState('failed')
      return
    }
    this.setState('restarting')
    const delay = RESTART_DELAYS[this.restartCount++]!
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))
    if (this.stopping) return
    try {
      await this.spawnOnce()
    } catch (error) {
      console.error('[daemon] 重启失败', error)
      await this.restart()
    }
  }

  private resolveLaunch(): { command: string; args: string[]; cwd?: string } {
    const executable = process.platform === 'win32' ? 'rocket-leafd.exe' : 'rocket-leafd'
    if (app.isPackaged) return { command: join(process.resourcesPath, 'bin', executable), args: [] }
    if (process.env.ROCKET_LEAF_DAEMON_PATH)
      return { command: resolve(process.env.ROCKET_LEAF_DAEMON_PATH), args: [] }
    const daemonRoot = resolve(app.getAppPath(), '..', 'daemon')
    const built = join(daemonRoot, 'dist', executable)
    if (existsSync(built)) return { command: built, args: [] }
    return { command: 'go', args: ['run', './cmd/rocket-leafd'], cwd: daemonRoot }
  }

  private setState(state: DaemonState): void {
    if (state === this.currentState) return
    this.currentState = state
    this.emit('state', state)
  }
}
