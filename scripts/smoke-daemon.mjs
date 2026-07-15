import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const daemonDir = resolve(root, 'daemon')
const packageVersion = JSON.parse(
  readFileSync(resolve(root, 'desktop/package.json'), 'utf8'),
).version

// Build a real binary first. `go run` compiles on every invocation and, with a
// cold or isolated GOCACHE, routinely exceeds the ready timeout on CI runners.
const buildDir = mkdtempSync(join(tmpdir(), 'rocket-leaf-smoke-'))
const binary = join(buildDir, process.platform === 'win32' ? 'rocket-leafd.exe' : 'rocket-leafd')

function cleanup() {
  try {
    rmSync(buildDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

const build = spawnSync(
  'go',
  [
    'build',
    '-trimpath',
    `-ldflags=-X main.appVersion=${packageVersion}`,
    '-o',
    binary,
    './cmd/rocket-leafd',
  ],
  {
    cwd: daemonDir,
    encoding: 'utf8',
    env: process.env,
  },
)
if (build.status !== 0) {
  cleanup()
  throw new Error(
    `daemon 编译失败 (exit ${build.status}):\n${build.stderr || build.stdout || ''}`,
  )
}

const token = randomBytes(32).toString('base64url')
const child = spawn(binary, [], {
  cwd: daemonDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ROCKET_LEAF_PARENT_PID: String(process.pid),
  },
})
child.stdin.write(`${JSON.stringify({ token })}\n`)

const errors = []
child.stderr.on('data', (chunk) => errors.push(chunk.toString()))

const READY_TIMEOUT_MS = 15_000
const EXIT_TIMEOUT_MS = 5_000

const lines = createInterface({ input: child.stdout })
let ready
try {
  ready = await Promise.race([
    new Promise((resolveReady, rejectReady) => {
      lines.once('line', (line) => {
        try {
          resolveReady(JSON.parse(line))
        } catch (error) {
          rejectReady(error)
        }
      })
      child.once('exit', (code) =>
        rejectReady(new Error(`daemon 就绪前退出: ${code}\n${errors.join('')}`)),
      )
    }),
    new Promise((_, rejectTimeout) =>
      setTimeout(() => {
        child.kill('SIGKILL')
        rejectTimeout(
          new Error(
            `daemon 启动超时 (${READY_TIMEOUT_MS}ms)\nstderr:\n${errors.join('') || '(empty)'}`,
          ),
        )
      }, READY_TIMEOUT_MS),
    ),
  ])
} catch (error) {
  cleanup()
  throw error
}

if (ready.protocolVersion !== 1 || !Number.isInteger(ready.port) || ready.port < 1) {
  child.kill('SIGKILL')
  cleanup()
  throw new Error(`daemon 就绪信息无效: ${JSON.stringify(ready)}`)
}
if (ready.appVersion && ready.appVersion !== packageVersion) {
  console.warn(
    `警告: daemon appVersion=${ready.appVersion} 与 desktop version=${packageVersion} 不一致`,
  )
}

try {
  const unauthorized = await fetch(`http://127.0.0.1:${ready.port}/v1/health`)
  if (unauthorized.status !== 401)
    throw new Error(`无令牌请求状态应为 401，实际为 ${unauthorized.status}`)
  const health = await fetch(`http://127.0.0.1:${ready.port}/v1/health`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!health.ok || (await health.json()).status !== 'ok') throw new Error('daemon 健康检查失败')

  // Wrong token must still fail (constant-time path).
  const wrong = await fetch(`http://127.0.0.1:${ready.port}/v1/health`, {
    headers: { Authorization: `Bearer ${token.slice(0, -1)}x` },
  })
  if (wrong.status !== 401) throw new Error(`错误令牌状态应为 401，实际为 ${wrong.status}`)

  child.stdin.end()
  await Promise.race([
    new Promise((resolveExit, rejectExit) =>
      child.once('exit', (code) =>
        code === 0 ? resolveExit() : rejectExit(new Error(`daemon 退出码: ${code}`)),
      ),
    ),
    new Promise((_, rejectTimeout) =>
      setTimeout(() => {
        child.kill('SIGKILL')
        rejectTimeout(new Error('stdin 关闭后 daemon 未在五秒内退出'))
      }, EXIT_TIMEOUT_MS),
    ),
  ])
} finally {
  if (!child.killed && child.exitCode === null) {
    child.kill('SIGKILL')
  }
  cleanup()
}

console.log('daemon 启动、鉴权、健康检查与父进程管道退出冒烟通过')
