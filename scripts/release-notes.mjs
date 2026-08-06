// Builds the GitHub Release body for a tag from the bilingual changelogs.
//
// Usage: node scripts/release-notes.mjs v0.1.1 [> notes.md]
//
// The release workflow writes the output to a file and hands it to the release
// action, so the published notes stay in step with what is committed here
// instead of being generated from commit subjects.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = 'https://github.com/amigoer/rocket-leaf'

const sources = [
  { path: 'CHANGELOG.md', heading: 'English' },
  { path: 'CHANGELOG.zh-CN.md', heading: '简体中文' },
]

const tag = process.env.RELEASE_TAG ?? process.argv[2]
if (!tag) {
  throw new Error('usage: node scripts/release-notes.mjs <tag>')
}
const version = tag.replace(/^v/, '')

/** Trailing `[0.1.0]: https://…` definitions that belong to the file, not a section. */
const LINK_DEFINITION = /^\[[^\]]+\]:\s/

/**
 * Returns the body of the `## [version] - date` section: everything up to the
 * next top-level heading, with the version heading itself dropped so the
 * caller can place the section under a language heading of its own.
 *
 * The oldest section has no heading after it, so the file's link-reference
 * definitions would otherwise be read as part of it.
 */
function extractSection(changelog, path) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
  if (start === -1) {
    throw new Error(`${path} has no section for ${version}`)
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  const section = end === -1 ? rest : rest.slice(0, end)
  while (section.length > 0) {
    const last = section[section.length - 1]
    if (last.trim() !== '' && !LINK_DEFINITION.test(last)) break
    section.pop()
  }
  const body = section.join('\n').trim()
  if (!body) {
    throw new Error(`${path} has an empty section for ${version}`)
  }
  return body
}

const sections = await Promise.all(
  sources.map(async ({ path, heading }) => {
    const changelog = await readFile(resolve(root, path), 'utf8')
    return `## ${heading}\n\n${extractSection(changelog, path)}`
  }),
)

// Link comparisons are only meaningful once a previous release exists. The
// fallback points at the default branch because the very first release
// predates the changelog it is being written into.
const previous = process.env.PREVIOUS_TAG?.trim()
const footer = previous
  ? `**Full Changelog**: ${repository}/compare/${previous}...${tag}`
  : `**Changelog**: ${repository}/blob/main/CHANGELOG.md`

process.stdout.write(`${sections.join('\n\n')}\n\n---\n\n${footer}\n`)
