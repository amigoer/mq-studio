/**
 * Fabricates the throughput history the overview chart plots.
 *
 * The chart is drawn from tps-history.json, which the in-process collector
 * fills one bucket a minute. A cluster that is idle - or that has only just
 * been started - therefore plots a flat line, which is not what a screenshot
 * of the feature should show. This writes a plausible hour into that file.
 *
 * Two things to know before running it:
 *
 *   - MQ Studio must be closed. The history is loaded into memory once at
 *     startup and written back from there, so a running app would overwrite
 *     this and never read it.
 *   - The collector keeps sampling once the app is open again, so the newest
 *     bucket returns to the broker's real value every minute. Expect a good
 *     hour of chart, decaying from the right edge. Re-run and restart to reset.
 *
 * Usage:
 *   node scripts/mock-tps-history.mjs                    # the default connection
 *   node scripts/mock-tps-history.mjs --conn 测试 --in 2400 --out 2900
 *   node scripts/mock-tps-history.mjs --restore          # put the real file back
 */
import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

const MINUTES = 60

function configDir() {
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'mq-studio')
  if (platform() === 'win32') return join(process.env.APPDATA ?? homedir(), 'mq-studio')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mq-studio')
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

/**
 * One bucket's value.
 *
 * Three sine waves at unrelated periods plus a small deterministic wobble: the
 * line has a shape a reader can follow rather than noise, and it is the same
 * every run so a re-recorded take matches the last one.
 */
function rate(base, minute, phase) {
  const wobble = Math.sin(minute * 12.9898 + phase) * 43758.5453
  const jitter = (wobble - Math.floor(wobble)) * 0.06 - 0.03
  const shaped =
    1 +
    0.22 * Math.sin((minute / 37) * Math.PI * 2 + phase) +
    0.11 * Math.sin((minute / 11) * Math.PI * 2 + phase * 2) +
    0.05 * Math.sin((minute / 4) * Math.PI * 2 + phase * 3) +
    jitter
  return Math.max(1, Math.round(base * shaped))
}

const dir = configDir()
const historyPath = join(dir, 'tps-history.json')
const backupPath = join(dir, 'tps-history.real.json')

if (process.argv.includes('--restore')) {
  await access(backupPath)
  await copyFile(backupPath, historyPath)
  console.log(`Restored the real history from ${backupPath}`)
  process.exit(0)
}

const connections = JSON.parse(await readFile(join(dir, 'connections.json'), 'utf8'))
const wanted = arg('conn')
const connection = wanted
  ? connections.connections.find((entry) => entry.name === wanted)
  : connections.connections.find((entry) => entry.isDefault)
if (!connection) {
  console.error(
    wanted
      ? `No connection named "${wanted}". Have: ${connections.connections.map((c) => c.name).join(', ')}`
      : 'No default connection to fabricate history for.',
  )
  process.exit(1)
}

const history = JSON.parse(await readFile(historyPath, 'utf8'))
history.brokers ??= {}

// Only the brokers this connection has already sampled: the key carries the
// address, and inventing one the cluster does not have would put a broker in
// the chart legend that the broker list does not show.
const keys = Object.keys(history.brokers).filter((key) => key.startsWith(`${connection.id}|`))
if (keys.length === 0) {
  console.error(
    `No sampled brokers for connection ${connection.id} (${connection.name}).\n` +
      'Open the app on that connection for a minute first, so the collector records which brokers exist.',
  )
  process.exit(1)
}

const baseIn = Number(arg('in', 2400))
const baseOut = Number(arg('out', 2900))
const nowMinute = Math.floor(Date.now() / 60000) * 60

// Only the first run backs up. A second run would otherwise copy the already
// fabricated file over the real one, and --restore would hand back a fake.
try {
  await access(backupPath)
} catch {
  await copyFile(historyPath, backupPath)
}
for (const [index, key] of keys.entries()) {
  const phase = index * 1.7
  history.brokers[key] = {
    samples: Array.from({ length: MINUTES }, (_, bucket) => ({
      timestamp: nowMinute - (MINUTES - 1 - bucket) * 60,
      tpsIn: rate(baseIn, bucket, phase),
      tpsOut: rate(baseOut, bucket, phase + 0.6),
    })),
  }
}
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`)

console.log(`Wrote ${MINUTES} minutes of throughput for "${connection.name}" (${keys.join(', ')}).`)
console.log(`Real file backed up to ${backupPath} - restore it with --restore.`)
console.log('Start MQ Studio now; it reads this file once at startup.')
