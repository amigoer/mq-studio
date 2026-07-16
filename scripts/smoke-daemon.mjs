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
    `daemon build failed (exit ${build.status}):\n${build.stderr || build.stdout || ''}`,
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
        rejectReady(new Error(`daemon exited before ready: ${code}\n${errors.join('')}`)),
      )
    }),
    new Promise((_, rejectTimeout) =>
      setTimeout(() => {
        child.kill('SIGKILL')
        rejectTimeout(
          new Error(
            `daemon start timed out (${READY_TIMEOUT_MS}ms)\nstderr:\n${errors.join('') || '(empty)'}`,
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
  throw new Error(`invalid daemon ready message: ${JSON.stringify(ready)}`)
}
if (ready.appVersion && ready.appVersion !== packageVersion) {
  console.warn(
    `warning: daemon appVersion=${ready.appVersion} does not match desktop version=${packageVersion}`,
  )
}

try {
  const unauthorized = await fetch(`http://127.0.0.1:${ready.port}/v1/health`)
  if (unauthorized.status !== 401)
    throw new Error(`unauthenticated request should return 401, got ${unauthorized.status}`)
  const health = await fetch(`http://127.0.0.1:${ready.port}/v1/health`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!health.ok || (await health.json()).status !== 'ok') throw new Error('daemon health check failed')

  // Wrong token must still fail (constant-time path).
  const wrong = await fetch(`http://127.0.0.1:${ready.port}/v1/health`, {
    headers: { Authorization: `Bearer ${token.slice(0, -1)}x` },
  })
  if (wrong.status !== 401) throw new Error(`wrong token should return 401, got ${wrong.status}`)

  child.stdin.end()
  await Promise.race([
    new Promise((resolveExit, rejectExit) =>
      child.once('exit', (code) =>
        code === 0 ? resolveExit() : rejectExit(new Error(`daemon exit code: ${code}`)),
      ),
    ),
    new Promise((_, rejectTimeout) =>
      setTimeout(() => {
        child.kill('SIGKILL')
        rejectTimeout(new Error('daemon did not exit within five seconds after stdin closed'))
      }, EXIT_TIMEOUT_MS),
    ),
  ])
} finally {
  if (!child.killed && child.exitCode === null) {
    child.kill('SIGKILL')
  }
  cleanup()
}

console.log('daemon start, auth, health check, and parent-pipe exit smoke passed')
