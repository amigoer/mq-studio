import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageVersion = JSON.parse(
  readFileSync(resolve(root, 'desktop/package.json'), 'utf8'),
).version
const token = randomBytes(32).toString('base64url')
const child = spawn('go', ['run', './cmd/rocket-leafd'], {
  cwd: resolve(root, 'daemon'),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    GOCACHE: '/tmp/rocket-leaf-go-build',
    ROCKET_LEAF_PARENT_PID: String(process.pid),
  },
})
child.stdin.write(`${JSON.stringify({ token })}\n`)

const errors = []
child.stderr.on('data', (chunk) => errors.push(chunk.toString()))
const lines = createInterface({ input: child.stdout })
const ready = await Promise.race([
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
    setTimeout(() => rejectTimeout(new Error('daemon 启动超时')), 10_000),
  ),
])

if (ready.protocolVersion !== 1 || !Number.isInteger(ready.port) || ready.port < 1) {
  throw new Error(`daemon 就绪信息无效: ${JSON.stringify(ready)}`)
}
if (ready.appVersion && ready.appVersion !== packageVersion) {
  console.warn(
    `警告: daemon appVersion=${ready.appVersion} 与 desktop version=${packageVersion} 不一致（go run 使用默认值属预期）`,
  )
}

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
    }, 5_000),
  ),
])

console.log('daemon 启动、鉴权、健康检查与父进程管道退出冒烟通过')
