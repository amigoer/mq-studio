// Pins which attempt of a shard ci-coverage.mjs reads. That only matters after
// a re-run, which an ordinary CI run never has, so nothing else would notice it
// break. Each case writes what download-artifact would leave and runs the
// script over it, as the coverage job does.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const PACKAGE = 'github.com/amigoer/mq-studio/internal/app'
const KAFKA = 'TestLiveKafkaACL'
const RABBITMQ = 'TestLiveRabbitMQBrowse'

/** The `go test -json` events for one test, closed by `action`. */
function events(name, action, output) {
  const test = { Package: PACKAGE, Test: name }
  return [
    { Action: 'run', ...test },
    ...(output ? [{ Action: 'output', ...test, Output: `    ${output}\n` }] : []),
    { Action: action, ...test },
  ]
}

const passes = (name) => events(name, 'pass')
const fails = (name) => events(name, 'fail')
// What the unit job, which claims no family, records for every live test.
const gateSkips = (name) => events(name, 'skip', '[e2e-gate] this run covers MQ_STUDIO_E2E_FAMILIES=none')
const skipsItself = (name) => events(name, 'skip', 'this broker runs plain_acl, not 5.3 authentication')

/** Runs the script over { file name: events } and returns how it exited. */
function check(files) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-coverage-'))
  try {
    for (const [file, lines] of Object.entries(files)) {
      writeFileSync(join(directory, file), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
    }
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(here, 'ci-coverage.mjs'), directory], {
      encoding: 'utf8',
    })
    return { status, stdout, stderr }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('a re-run that passes replaces the attempt that failed', () => {
  const result = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-1.json': fails(KAFKA),
    'results-kafka-attempt-2.json': passes(KAFKA),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /superseded by a later attempt, not read: results-kafka-attempt-1\.json/)
})

test('a failure in the latest attempt fails, whatever an earlier attempt did', () => {
  const result = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-1.json': passes(KAFKA),
    'results-kafka-attempt-2.json': fails(KAFKA),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /test\(s\) failed:\n.*TestLiveKafkaACL \(in kafka\)/)
})

test('a test the latest attempt did not run is unrun, even if an earlier attempt passed it', () => {
  const result = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-1.json': passes(KAFKA),
    'results-kafka-attempt-2.json': gateSkips(KAFKA),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ran in no shard[^\n]*\n.*TestLiveKafkaACL/)
})

test('attempts compare as numbers, not as file names', () => {
  // By name attempt-10 sorts before attempt-9.
  const result = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-9.json': passes(KAFKA),
    'results-kafka-attempt-10.json': fails(KAFKA),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /TestLiveKafkaACL \(in kafka\)/)
})

test('a shard that was not re-run still counts its only attempt', () => {
  // Latest per shard, not the run's latest attempt: that would drop rabbitmq.
  const result = check({
    'results-unit-attempt-2.json': [...gateSkips(KAFKA), ...gateSkips(RABBITMQ)],
    'results-kafka-attempt-1.json': fails(KAFKA),
    'results-kafka-attempt-2.json': passes(KAFKA),
    'results-rabbitmq-attempt-1.json': passes(RABBITMQ),
  })
  assert.equal(result.status, 0, result.stderr)
})

test('the unit inventory is read from its latest attempt too', () => {
  const result = check({
    'results-unit-attempt-1.json': [...fails('TestParseShard'), ...gateSkips(KAFKA)],
    'results-unit-attempt-2.json': [...passes('TestParseShard'), ...gateSkips(KAFKA)],
    'results-kafka-attempt-1.json': passes(KAFKA),
  })
  assert.equal(result.status, 0, result.stderr)
})

test('the unit inventory is required', () => {
  const result = check({ 'results-kafka-attempt-1.json': passes(KAFKA) })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /results-unit-attempt-<n>\.json is missing/)
})

test('a results file with no attempt is refused rather than skipped', () => {
  const result = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-1.json': passes(KAFKA),
    'results-kafka.json': fails(KAFKA),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /results-kafka\.json/)
})

test('a skip the test made itself still counts, and a gate skip does not', () => {
  const own = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-1.json': skipsItself(KAFKA),
  })
  assert.equal(own.status, 0, own.stderr)

  const gate = check({
    'results-unit-attempt-1.json': gateSkips(KAFKA),
    'results-kafka-attempt-1.json': gateSkips(KAFKA),
  })
  assert.equal(gate.status, 1)
})

// The workflow half of the fix is just as invisible until a re-run: an
// artifact name without the attempt collapses back to one artifact.
test('ci.yml names every results artifact, and the file in it, by attempt', () => {
  const workflow = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8')
  const artifacts = workflow.match(/^\s*name: results-.*$/gm) ?? []
  const uploads = [...workflow.matchAll(/^\s*name: (results-.*)\n\s*path: (.*)$/gm)]

  assert.ok(artifacts.length > 0, 'found no results artifacts in ci.yml; this test needs to follow them')
  assert.equal(uploads.length, artifacts.length, 'every results artifact should be followed by its path')
  for (const [, name, path] of uploads) {
    assert.ok(name.endsWith('-attempt-${{ github.run_attempt }}'), `${name} does not carry the attempt`)
    assert.equal(path, `${name}.json`)
  }
})
