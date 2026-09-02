// Proves that the sharded CI run exercised everything an unsharded run would.
//
// Splitting the live suites across one job per broker family means a test can
// now go unrun without anything turning red: every shard it is not claimed by
// skips it, and a family no shard claims is skipped by all of them. That is
// the shape of issue #48, where the whole app-layer suite skipped every CI run
// and asserted nothing for weeks.
//
// So the shards do not gate on their own. This does, over their combined
// `go test -json` output:
//
//   every test must have passed in at least one shard, unless it skipped
//   itself for a reason of its own.
//
// The distinction is what e2e.SkipMarker is for. A skip carrying the marker
// came from the gate - no shard claimed the family, or the broker was absent -
// and does not count as coverage. A skip without it came from the test body
// ("this broker runs plain_acl, not 5.3 authentication"), which is a
// deliberate omission an unsharded run would make too.
//
// Usage: node scripts/ci-coverage.mjs <directory of results-*.json>

import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SKIP_MARKER = '[e2e-gate]'

// The unit job runs `go test ./...` with no broker, so its output is the only
// one that names every test in the repository. Without it the inventory would
// be whatever the shards happened to cover, which cannot catch a dropped one.
const INVENTORY = 'results-unit.json'

const directory = process.argv[2]
if (!directory) {
  console.error('usage: node scripts/ci-coverage.mjs <directory of results-*.json>')
  process.exit(2)
}

const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
if (!files.includes(INVENTORY)) {
  console.error(`${INVENTORY} is missing from ${directory}: without it there is no full test inventory to check the shards against.`)
  console.error(`found: ${files.join(', ') || '(nothing)'}`)
  process.exit(1)
}

/** One row per test, accumulated across every shard. */
const tests = new Map()

function row(key) {
  if (!tests.has(key)) {
    tests.set(key, { passedIn: [], skippedIn: [], failedIn: [], ownSkip: false })
  }
  return tests.get(key)
}

for (const file of files) {
  const shard = file.replace(/^results-/, '').replace(/\.json$/, '')
  const content = await readFile(resolve(directory, file), 'utf8')

  // Output events arrive before the pass/skip/fail that closes a test, so the
  // marker has to be remembered until the verdict lands.
  const markers = new Set()

  for (const line of content.split('\n')) {
    if (!line.trim()) continue

    let event
    try {
      event = JSON.parse(line)
    } catch {
      // `go test -json` interleaves build errors as plain text. A build
      // failure already fails its own shard, so skipping the line here loses
      // nothing this check is responsible for.
      continue
    }
    if (!event.Test) continue

    const key = `${event.Package}.${event.Test}`
    if (event.Action === 'output' && event.Output?.includes(SKIP_MARKER)) {
      markers.add(key)
      continue
    }
    if (event.Action === 'pass') row(key).passedIn.push(shard)
    else if (event.Action === 'fail') row(key).failedIn.push(shard)
    else if (event.Action === 'skip') {
      row(key).skippedIn.push(shard)
      if (!markers.has(key)) row(key).ownSkip = true
    }
  }
}

const unrun = []
const failed = []
for (const [key, result] of tests) {
  if (result.failedIn.length > 0) failed.push({ key, ...result })
  else if (result.passedIn.length === 0 && !result.ownSkip) unrun.push({ key, ...result })
}

const covered = tests.size - unrun.length - failed.length
console.log(`shards: ${files.map((f) => f.replace(/^results-|\.json$/g, '')).join(', ')}`)
console.log(`tests seen: ${tests.size}`)
console.log(`covered:    ${covered}`)

if (failed.length > 0) {
  console.error(`\n${failed.length} test(s) failed:`)
  for (const test of failed) console.error(`  ${test.key} (in ${test.failedIn.join(', ')})`)
}

if (unrun.length > 0) {
  console.error(`\n${unrun.length} test(s) ran in no shard - every skip came from the e2e gate:`)
  for (const test of unrun) console.error(`  ${test.key} (skipped in ${test.skippedIn.join(', ') || 'no shard at all'})`)
  console.error('\nEither no shard claims that test\'s broker family, or the family\'s')
  console.error('environment did not come up. Both mean the sharded run asserted less')
  console.error('than an unsharded one would. See internal/e2e/e2e.go.')
}

process.exit(failed.length > 0 || unrun.length > 0 ? 1 : 0)
