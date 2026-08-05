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

/**
 * Returns the body of the `## [version] - date` section: everything up to the
 * next top-level heading, with the version heading itself dropped so the
 * caller can place the section under a language heading of its own.
 */
function extractSection(changelog, path) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
  if (start === -1) {
    throw new Error(`${path} has no section for ${version}`)
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
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

// Link comparisons are only meaningful once a previous release exists.
const previous = process.env.PREVIOUS_TAG?.trim()
const footer = previous
  ? `**Full Changelog**: ${repository}/compare/${previous}...${tag}`
  : `**Changelog**: ${repository}/blob/${tag}/CHANGELOG.md`

process.stdout.write(`${sections.join('\n\n')}\n\n---\n\n${footer}\n`)
