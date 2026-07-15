import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

interface Connection {
  id: number
  name: string
  nameServer: string
  status: 'online' | 'offline'
}

interface ClusterInfo {
  clusterName: string
  brokers: Array<{ brokerName: string; address: string }>
}

interface TopicItem {
  topic: string
  routes?: Array<{ brokerAddr: string }>
}

interface MessageItem {
  messageId: string
  topic: string
  keys: string
  tags: string
  body: string
}

const desktopRoot = resolve(import.meta.dirname, '../..')
const testHome = resolve(tmpdir(), `rocket-leaf-electron-e2e-${process.pid}`)
const daemonPlatform =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
const daemonArch = process.arch === 'x64' ? 'x64' : 'arm64'
const daemonPath = resolve(
  desktopRoot,
  'resources/bin',
  daemonPlatform,
  daemonArch,
  process.platform === 'win32' ? 'rocket-leafd.exe' : 'rocket-leafd',
)
const topic = `RocketLeafE2E_${Date.now()}`
const key = `key-${randomBytes(6).toString('hex')}`

let app: ElectronApplication
let page: Page
const electronLogs: string[] = []

async function backend<T>(operation: string, payload?: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    ({ operation, payload }) =>
      window.rocketLeaf.backend.call<T>({
        operation: operation as Parameters<typeof window.rocketLeaf.backend.call>[0]['operation'],
        payload,
      }),
    { operation, payload },
  )
}

async function waitFor<T>(action: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  let lastValue: T | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      lastValue = await action()
      if (predicate(lastValue)) return lastValue
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000))
  }
  throw lastError ?? new Error(`等待条件超时，最后结果：${JSON.stringify(lastValue)}`)
}

test.beforeAll(async () => {
  await mkdir(testHome, { recursive: true })
  app = await electron.launch({
    args: ['.'],
    cwd: desktopRoot,
    env: {
      ...process.env,
      HOME: testHome,
      GOCACHE: resolve(tmpdir(), 'rocket-leaf-go-build'),
      ROCKET_LEAF_DAEMON_PATH: daemonPath,
    },
  })
  app.process().stdout?.on('data', (chunk) => electronLogs.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk) => electronLogs.push(chunk.toString()))
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  try {
    await expect
      .poll(() => page.evaluate(() => window.rocketLeaf.daemon.state()), { timeout: 20_000 })
      .toBe('ready')
  } catch (error) {
    throw new Error(`Electron daemon 未就绪：\n${electronLogs.join('')}`, { cause: error })
  }
})

test.afterAll(async () => {
  await app?.close()
  await rm(testHome, { recursive: true, force: true })
})

test('Electron 安全桥可以完成 RocketMQ 核心业务闭环', async () => {
  const created = await backend<Connection>('connections.add', {
    name: 'OrbStack RocketMQ',
    env: '测试',
    nameServer: '127.0.0.1:9876',
    timeoutSec: 10,
    enableACL: false,
    accessKey: '',
    secretKey: '',
    remark: 'Electron E2E',
  })
  expect(created.id).toBeGreaterThan(0)

  await backend('connections.connect', { id: created.id })
  const connections = await backend<Connection[]>('connections.list')
  expect(connections).toContainEqual(expect.objectContaining({ id: created.id, status: 'online' }))

  const cluster = await waitFor(
    () => backend<ClusterInfo>('cluster.info'),
    (value) => value.brokers.some((broker) => broker.brokerName === 'broker-a'),
  )
  expect(cluster.clusterName).toBe('DefaultCluster')
  const broker = cluster.brokers.find((item) => item.brokerName === 'broker-a')
  expect(broker?.address).toBe('127.0.0.1:10911')

  await backend('topics.create', {
    topic,
    brokerAddr: broker!.address,
    readQueue: 4,
    writeQueue: 4,
    perm: 'RW',
  })

  const topics = await waitFor(
    () => backend<TopicItem[]>('topics.list'),
    (items) => items.some((item) => item.topic === topic),
  )
  expect(topics.some((item) => item.topic === topic)).toBe(true)

  const sent = await backend<{ messageId: string }>('messages.send', {
    topic,
    tags: 'e2e',
    keys: key,
    body: JSON.stringify({ source: 'electron', runtime: 'orbstack' }),
    delayLevel: 0,
  })
  expect(sent.messageId).not.toBe('')

  const messages = await waitFor(
    () =>
      backend<MessageItem[]>('messages.query', {
        topic,
        key: '',
        tag: '',
        maxResults: 10,
        startTime: Date.now() - 60_000,
        endTime: Date.now() + 60_000,
      }),
    (items) => items.some((item) => item.messageId === sent.messageId),
  )
  expect(messages).toContainEqual(
    expect.objectContaining({
      messageId: sent.messageId,
      topic,
      keys: key,
      tags: 'e2e',
    }),
  )

  const byId = await waitFor(
    () =>
      backend<MessageItem>('messages.byId', {
        topic,
        messageId: sent.messageId,
      }),
    (item) => item.messageId === sent.messageId,
  )
  expect(byId).toEqual(expect.objectContaining({ messageId: sent.messageId, topic, keys: key }))

  const messagesByKey = await waitFor(
    () =>
      backend<MessageItem[]>('messages.query', {
        topic,
        key,
        tag: '',
        maxResults: 10,
        startTime: Date.now() - 60_000,
        endTime: Date.now() + 60_000,
      }),
    (items) => items.some((item) => item.messageId === sent.messageId),
  )
  expect(messagesByKey).toContainEqual(
    expect.objectContaining({ messageId: sent.messageId, keys: key }),
  )

  const topicDetail = await backend<TopicItem>('topics.detail', { topic })
  expect(topicDetail.topic).toBe(topic)
  expect(topicDetail.routes?.some((route) => route.brokerAddr === '127.0.0.1:10911')).toBe(true)
})
