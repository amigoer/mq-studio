import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'

interface Connection {
  id: number
  nameServer: string
  status: 'online' | 'offline'
}

interface ClusterInfo {
  clusterName: string
  brokers: Array<{ brokerName: string; address: string }>
}

interface TopicItem {
  topic: string
}

interface MessageItem {
  messageId: string
  topic: string
  body: string
}

const desktopRoot = resolve(import.meta.dirname, '../..')
const testHome = resolve(tmpdir(), `rocket-leaf-producer-drafts-e2e-${process.pid}`)
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

const stamp = Date.now()
const topicA = `RocketLeafDraftA_${stamp}`
const topicB = `RocketLeafDraftB_${stamp}`
const bodyA = '{"who":"A"}'
const bodyB = '{"who":"B"}'

// The daemon ships zh as the default language, and a fresh HOME never overrides it.
const DRAFT_HINT = '已保存该 Topic 上次发送的内容'
const SEND_OK = '消息已发送'
const TOPIC_PLACEHOLDER = '选择 Topic'
const DELAY_NONE = '不延迟'
const DELAY_1S = '1 秒'
const STORAGE_KEY = 'rocket-leaf:producer-drafts'

let app: ElectronApplication
let page: Page
let clusterName = 'DefaultCluster'
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
  throw lastError ?? new Error(`wait condition timed out, last value: ${JSON.stringify(lastValue)}`)
}

const nav = (label: string) => page.getByRole('button', { name: label, exact: true })
// `Select` is a Radix Popover combobox, not a native <select>: the trigger carries the
// current label as text and the options only exist in a portal while it is open.
const topicSelect = () => page.getByRole('combobox').first()
const delaySelect = () => page.getByRole('combobox').nth(1)
const tagInput = () => page.getByPlaceholder('如 order.create')
const keyInput = () => page.getByPlaceholder('如 ORD-...')
const bodyArea = () => page.locator('textarea')
const sendButton = () => page.getByRole('button', { name: '发送', exact: true })
const resetButton = () => page.getByRole('button', { name: '重置', exact: true })

async function openProducer(): Promise<void> {
  await expect(nav('发送测试')).toBeEnabled({ timeout: 30_000 })
  await nav('发送测试').click()
  await expect(page.getByText('发送测试消息')).toBeVisible()
  await expect(topicSelect()).toBeVisible({ timeout: 30_000 })
}

/** Opens a combobox and picks an option, retrying while the topic list is still loading. */
async function pick(trigger: Locator, optionName: string): Promise<void> {
  const option = page.getByRole('option', { name: optionName, exact: true })
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Escape')
        await trigger.click()
        return option.count()
      },
      { timeout: 30_000 },
    )
    .toBe(1)
  await option.click()
  await expect(trigger).toHaveText(optionName)
}

/** Sends and waits for the toast to come and go, so the next send starts from a clean slate. */
async function send(): Promise<void> {
  await sendButton().click()
  await expect(page.getByText(SEND_OK)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(SEND_OK)).toBeHidden({ timeout: 20_000 })
}

async function expectForm(fields: {
  topic: string
  tag: string
  key: string
  delay: string
  body: string
}): Promise<void> {
  await expect(topicSelect()).toHaveText(fields.topic)
  await expect(tagInput()).toHaveValue(fields.tag)
  await expect(keyInput()).toHaveValue(fields.key)
  await expect(delaySelect()).toHaveText(fields.delay)
  await expect(bodyArea()).toHaveValue(fields.body)
}

test.beforeAll(async () => {
  await mkdir(testHome, { recursive: true })
  app = await electron.launch({
    // HOME only isolates the daemon: on macOS Chromium resolves the user directory
    // through the OS, not the environment, so without this switch localStorage would
    // land in the developer's real profile and leak drafts between runs.
    args: ['.', `--user-data-dir=${resolve(testHome, 'electron')}`],
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
    throw new Error(`Electron daemon not ready:\n${electronLogs.join('')}`, { cause: error })
  }

  const created = await backend<Connection>('connections.add', {
    name: 'Draft E2E',
    env: 'test',
    nameServer: '127.0.0.1:9876',
    timeoutSec: 10,
    enableACL: false,
    accessKey: '',
    secretKey: '',
    remark: '',
  })
  await backend('connections.connect', { id: created.id })

  const cluster = await waitFor(
    () => backend<ClusterInfo>('cluster.info'),
    (value) => value.brokers.some((b) => b.brokerName === 'broker-a'),
  )
  clusterName = cluster.clusterName
  const brokerAddr = cluster.brokers.find((b) => b.brokerName === 'broker-a')!.address
  for (const topic of [topicA, topicB]) {
    await backend('topics.create', {
      topic,
      brokerAddr,
      readQueue: 4,
      writeQueue: 4,
      perm: 'RW',
    })
  }
  await waitFor(
    () => backend<TopicItem[]>('topics.list'),
    (items) => [topicA, topicB].every((t) => items.some((item) => item.topic === t)),
  )

  // Pick up the now-online connection instead of waiting out the 30s poll.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  for (const topic of [topicA, topicB]) {
    await backend('topics.remove', { topic, clusterName }).catch(() => {})
  }
  await app?.close()
  await rm(testHome, { recursive: true, force: true })
})

test('remembers the last sent content per topic', async () => {
  await openProducer()

  // --- send to topic A ------------------------------------------------------
  await expect(topicSelect()).toHaveText(TOPIC_PLACEHOLDER)
  await pick(topicSelect(), topicA)
  await tagInput().fill('tag-a')
  await keyInput().fill('key-a')
  await pick(delaySelect(), DELAY_1S)
  await bodyArea().fill(bodyA)
  await expect(page.getByText(DRAFT_HINT)).toBeHidden()
  await send()

  // The UI action really reached RocketMQ, not just localStorage.
  const delivered = await waitFor(
    () =>
      backend<MessageItem[]>('messages.query', {
        topic: topicA,
        key: '',
        tag: '',
        maxResults: 10,
        startTime: Date.now() - 120_000,
        endTime: Date.now() + 120_000,
      }),
    (items) => items.some((item) => item.body.includes('"who":"A"')),
  )
  expect(delivered.some((item) => item.topic === topicA)).toBe(true)

  // --- leaving and returning restores topic A -------------------------------
  await nav('概览').click()
  await openProducer()
  await expectForm({ topic: topicA, tag: 'tag-a', key: 'key-a', delay: DELAY_1S, body: bodyA })
  await expect(page.getByText(DRAFT_HINT)).toBeVisible()

  // --- a topic with no saved content leaves the form alone ------------------
  await pick(topicSelect(), topicB)
  await expect(page.getByText(DRAFT_HINT)).toBeHidden()
  await expectForm({ topic: topicB, tag: 'tag-a', key: 'key-a', delay: DELAY_1S, body: bodyA })

  // --- send different content to topic B ------------------------------------
  await tagInput().fill('tag-b')
  await keyInput().fill('key-b')
  await pick(delaySelect(), DELAY_NONE)
  await bodyArea().fill(bodyB)
  await send()

  // --- each topic keeps its own content -------------------------------------
  await pick(topicSelect(), topicA)
  await expectForm({ topic: topicA, tag: 'tag-a', key: 'key-a', delay: DELAY_1S, body: bodyA })
  await pick(topicSelect(), topicB)
  await expectForm({ topic: topicB, tag: 'tag-b', key: 'key-b', delay: DELAY_NONE, body: bodyB })

  // --- content survives a full renderer reload ------------------------------
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await openProducer()
  // topic B was the last one actually sent to, so that is where the page reopens.
  await expectForm({ topic: topicB, tag: 'tag-b', key: 'key-b', delay: DELAY_NONE, body: bodyB })
  await pick(topicSelect(), topicA)
  await expectForm({ topic: topicA, tag: 'tag-a', key: 'key-a', delay: DELAY_1S, body: bodyA })

  // --- reset clears the form and forgets the saved content ------------------
  await resetButton().click()
  await expectForm({ topic: topicA, tag: '', key: '', delay: DELAY_NONE, body: '' })
  await expect(page.getByText(DRAFT_HINT)).toBeHidden()

  await nav('概览').click()
  await openProducer()
  // Topic B is still the last topic sent to, and resetting A left its content untouched.
  await expectForm({ topic: topicB, tag: 'tag-b', key: 'key-b', delay: DELAY_NONE, body: bodyB })
  // A has nothing saved any more, so switching to it restores nothing and shows no hint —
  // and, by design, leaves whatever is currently in the form alone.
  await pick(topicSelect(), topicA)
  await expect(page.getByText(DRAFT_HINT)).toBeHidden()
  await expectForm({ topic: topicA, tag: 'tag-b', key: 'key-b', delay: DELAY_NONE, body: bodyB })

  // --- what actually landed in localStorage ---------------------------------
  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)
  expect(stored).toBeTruthy()
  const scopes = JSON.parse(stored!) as Record<
    string,
    { lastTopic: string; drafts: Record<string, { tag: string; body: string; savedAt: number }> }
  >
  const scopeKeys = Object.keys(scopes)
  expect(scopeKeys).toHaveLength(1)
  // Scoped per connection: `${id}:${nameServer}`.
  expect(scopeKeys[0]).toContain('127.0.0.1:9876')
  const scope = scopes[scopeKeys[0]]
  expect(scope.lastTopic).toBe(topicB)
  expect(Object.keys(scope.drafts)).toEqual([topicB])
  expect(scope.drafts[topicB].body).toBe(bodyB)
  expect(scope.drafts[topicB].savedAt).toBeGreaterThan(0)
})
