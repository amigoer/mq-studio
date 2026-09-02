// Asserts that a release's changelog names the issues that release closes.
//
// A reader only ever meets a change in the release notes, and the only durable
// record of which issue asked for it is the commit footer -- which nothing
// forces into the changelog. This reads every `Closes #NN` in the commits a
// release covers and fails when the changelog does not name it, printing the
// numbers and the commit each arrived on so the section can be written
// straight from the failure.
//
// `Refs #NN` means the issue deliberately stays open, so it is reported and
// never required. `Fixes` and `Resolves` are not recognised: this repository
// uses one spelling for the footer and a second would only split it.
//
// Usage: node scripts/check-refs.mjs [v0.1.1]
//
// The three pure parts here -- footers out of a body, references out of a
// section, sections out of a file -- are what a test would cover if scripts/
// ever grows a runner. Node's own `node --test` is the zero-dependency one;
// there is no vitest at this level and adding one for a single script is not
// worth it while running it against the repository proves the same thing.
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** English first: it is the one the failure message names first. */
const CHANGELOGS = ['CHANGELOG.md', 'CHANGELOG.zh-CN.md']

// The last release cut before bullets carried references. The floor is tested
// against the range's base tag rather than the version being released, which is
// the only formulation that also skips a workflow_dispatch re-run of an old
// release instead of failing it for history nobody is going to backfill.
const ENFORCED_FROM = 'v0.0.5'

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const FOOTER = /^(Closes|Refs) #(\d+)[ \t]*$/gm
const HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\S+))?\s*$/
// Code first, so a bullet writing `#61` as a literal documents nothing. The
// same ordering as the two renderers, so all three agree on what a reference is.
const REFERENCE = /`[^`\n]*`|#(\d+)/g

/** Returns null rather than throwing: a missing tag is an expected answer here. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function compareTags(a, b) {
  const parse = (tag) => (TAG.exec(tag) ?? []).slice(1).map(Number)
  const [left, right] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}

function skip(reason) {
  console.log(`changelog references: ${reason}`)
  process.exit(0)
}

const requestedTag = process.env.RELEASE_TAG ?? process.argv[2]
const shallow = git('rev-parse', '--is-shallow-repository') === 'true'

let base
let range
let targetVersions
let acceptUnreleased

if (requestedTag) {
  if (!TAG.test(requestedTag)) {
    console.error(`not a release tag: ${requestedTag}`)
    process.exit(2)
  }
  // Shallow is fatal here and merely skipped below on purpose: release.yml
  // checks out with fetch-depth: 0, so a shallow tree in this mode means the
  // checkout regressed, and silently passing would be worse than failing.
  if (shallow) {
    console.error('this needs the full history to find the tag before it, and the')
    console.error('repository is a shallow clone. The checkout that runs it must set')
    console.error('fetch-depth: 0.')
    process.exit(1)
  }
  // Without this a tag that does not resolve - a typo, or a tag never created -
  // makes `describe` fail exactly the way a first release does, and the run
  // skips instead of failing.
  if (!git('rev-parse', '-q', '--verify', `refs/tags/${requestedTag}`)) {
    console.error(`no such tag: ${requestedTag}`)
    process.exit(2)
  }
  base = git('describe', '--tags', '--abbrev=0', `${requestedTag}^`)
  range = base ? `${base}..${requestedTag}` : requestedTag
  // A reference that ships has to be in the section that ships. Unreleased is
  // not a place a released note can live.
  targetVersions = [requestedTag.replace(/^v/, '')]
  acceptUnreleased = false
} else {
  if (shallow) skip('shallow clone - the range a release covers is not available')
  base = git('describe', '--tags', '--abbrev=0', 'HEAD')
  if (!base) skip('no tag reachable from HEAD - nothing defines a range')
  range = `${base}..HEAD`
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  // Day to day the pending references sit under Unreleased. While a release is
  // being prepared the version has been bumped, its tag does not exist yet, and
  // they are moving into the new section. Both are accepted so that a half
  // moved state is not reported as a failure.
  targetVersions = git('rev-parse', '-q', '--verify', `refs/tags/v${version}`) ? [] : [version]
  acceptUnreleased = true
}

if (!base) skip(`${range} is the first release - it predates the rule`)
if (compareTags(base, ENFORCED_FROM) < 0) {
  skip(`${range} predates the rule (references start after ${ENFORCED_FROM})`)
}

const log = git('log', '-z', '--format=%H%x1f%s%x1f%b', range)
if (log === null) {
  console.error(`cannot read the commits in ${range}`)
  process.exit(1)
}

/** number -> { closes, commits: [{ short, subject }] } */
const referenced = new Map()
for (const record of log.split('\0')) {
  if (record.trim() === '') continue
  const [sha, subject, body = ''] = record.split('\x1f')
  const short = sha.slice(0, 7)
  // The body only. The one squash-merged commit in this history carries a pull
  // request number in its subject, and reading subjects would silently require
  // a number nobody opened an issue for.
  for (const [, keyword, number] of body.matchAll(FOOTER)) {
    const entry = referenced.get(number) ?? { closes: false, commits: [] }
    entry.closes ||= keyword === 'Closes'
    if (!entry.commits.some((commit) => commit.short === short)) {
      entry.commits.push({ short, subject })
    }
    referenced.set(number, entry)
  }
}

/**
 * The references named by the sections this run is allowed to read, and the
 * headings of those sections. A heading with no trailing date is the unreleased
 * one, which is how both files are recognised without knowing that one says
 * "Unreleased" and the other "未发布".
 */
function namedIn(changelog) {
  const named = new Set()
  const headings = []
  let reading = false
  for (const line of changelog.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      const [, version, date] = heading
      reading = date === undefined ? acceptUnreleased : targetVersions.includes(version)
      if (reading) headings.push(`[${version}]`)
      continue
    }
    if (!reading) continue
    for (const [, number] of line.matchAll(REFERENCE)) {
      if (number !== undefined) named.add(number)
    }
  }
  return { named, headings }
}

const sections = new Map()
for (const path of CHANGELOGS) {
  sections.set(path, namedIn(await readFile(resolve(root, path), 'utf8')))
}

const required = [...referenced].filter(([, entry]) => entry.closes)
const advisory = [...referenced].filter(([, entry]) => !entry.closes)
const missing = required.filter(([number]) =>
  CHANGELOGS.some((path) => !sections.get(path).named.has(number)),
)

const [en, zh] = CHANGELOGS.map((path) => sections.get(path).named)
const onlyEn = [...en].filter((number) => !zh.has(number))
const onlyZh = [...zh].filter((number) => !en.has(number))

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

const list = (entries) =>
  entries
    .map(([number, entry]) =>
      entry.commits
        .map((commit, index) =>
          index === 0
            ? `  #${number.padEnd(4)} ${commit.short}  ${commit.subject}`
            : `  ${' '.repeat(5)} ${commit.short}  ${commit.subject}`,
        )
        .join('\n'),
    )
    .join('\n')

const where = (path) => `${path} ${sections.get(path).headings.join(' ') || '(no section)'}`

if (missing.length > 0) {
  console.log(
    `changelog references: ${range}, ${count(required.length, 'issue')} closed, ` +
      `${required.length - missing.length} named`,
  )
  console.error(
    `\n${count(missing.length, 'issue')} closed in ${range} ` +
      `${missing.length === 1 ? 'is' : 'are'} not named in the changelog:\n`,
  )
  console.error(list(missing))
  const absent = CHANGELOGS.filter((path) =>
    missing.some(([number]) => !sections.get(path).named.has(number)),
  )
  console.error(`\nMissing from ${absent.map(where).join(' and ')}.`)
  console.error('\nAdd the number to the bullet that already describes the change, as a')
  console.error('trailing parenthetical, in both files:\n')
  console.error(`  - RocketMQ 连接可以填写命名空间…… (#${missing[0][0]})\n`)
  console.error('Write it bare. The website, the release notes and the in-app update dialog')
  console.error('each turn it into a link of their own, and the files wrap at 80 columns.')
}

if (onlyEn.length > 0 || onlyZh.length > 0) {
  console.error(`\n${CHANGELOGS.join(' and ')} do not name the same issues:\n`)
  if (onlyEn.length > 0) console.error(`  only in ${CHANGELOGS[0]}:       ${onlyEn.map((n) => `#${n}`).join(', ')}`)
  if (onlyZh.length > 0) console.error(`  only in ${CHANGELOGS[1]}: ${onlyZh.map((n) => `#${n}`).join(', ')}`)
  console.error('\nThe two files are translations of one release. A reader of either')
  console.error('language has to be able to trace the same change.')
}

if (advisory.length > 0 && missing.length > 0) {
  console.error('\nNot required, but worth naming if a bullet covers them - these are Refs,')
  console.error('so the issue stays open:\n')
  console.error(list(advisory))
}

if (missing.length > 0 || onlyEn.length > 0 || onlyZh.length > 0) process.exit(1)

// A reference with no footer behind it is not an error: a bullet may credit a
// discussion issue, or one closed through the GitHub interface.
const extra = [...en].filter((number) => !referenced.has(number))
const summary = required.length > 0 ? `closes ${required.map(([n]) => `#${n}`).join(', ')}` : 'closes nothing'
console.log(`changelog references: ${range} ${summary} - named in both changelogs`)
if (extra.length > 0) {
  console.log(`  also named, with no commit footer behind them: ${extra.map((n) => `#${n}`).join(', ')}`)
}
