// Builds the GitHub Release body for a tag from the Chinese changelog.
//
// The body is one markdown document, so a release cannot carry two languages
// the way the README does with two files. Chinese is the body; English is a
// link to its own section of CHANGELOG.md, which is the README's arrangement
// as closely as a single document allows.
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
const repository = 'https://github.com/amigoer/mq-studio'

const ZH_CHANGELOG = 'CHANGELOG.zh-CN.md'
const EN_CHANGELOG = 'CHANGELOG.md'

/**
 * Warns that macOS builds are not notarised. Driven by MACOS_SIGNED so the
 * banner disappears on its own once a Developer ID is configured, rather than
 * relying on someone remembering to delete it.
 */
const UNSIGNED_BANNER = [
  '> [!IMPORTANT]',
  '> **macOS —— 此版本尚未使用 Apple 开发者证书签名。**',
  '> 将 MQ Studio 拖入 Applications 后，双击磁盘映像里的「首次运行」。',
  `> 详见 [安装说明](${repository}/blob/main/docs/INSTALL.zh-CN.md)。`,
].join('\n')

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

/**
 * GitHub's anchor for a heading: lowercased, punctuation dropped, spaces
 * hyphenated. Built from the English heading so the link lands on that
 * version's section rather than the top of the file.
 */
function headingAnchor(changelog, path) {
  const heading = changelog
    .split('\n')
    .find((line) => line.startsWith(`## [${version}]`))
  if (heading === undefined) {
    throw new Error(`${path} has no section for ${version}`)
  }
  return heading
    .replace(/^##\s+/, '')
    .toLowerCase()
    .replace(/[^\w -]/g, '')
    .trim()
    .replace(/ /g, '-')
}

/**
 * Expands a bullet's bare `#61` into a link. The changelogs write references
 * bare because they wrap at 80 columns and the website parses them by hand, so
 * this is where the number becomes something a reader can follow. `/issues/`
 * is right for a pull request too - GitHub redirects it.
 *
 * Code spans and links are matched only so they can be skipped: a bullet may
 * write a literal `#61`, and this runs on the extracted section rather than on
 * the assembled body because the English link's anchor is `#005---2026-09-02`.
 */
const REFERENCE = /`[^`\n]*`|\[[^\]]*\]\([^)]*\)|#(\d+)/g

function linkReferences(section) {
  return section.replace(REFERENCE, (all, number) =>
    number === undefined ? all : `[#${number}](${repository}/issues/${number})`,
  )
}

const zhChangelog = await readFile(resolve(root, ZH_CHANGELOG), 'utf8')
const enChangelog = await readFile(resolve(root, EN_CHANGELOG), 'utf8')
const anchor = headingAnchor(enChangelog, EN_CHANGELOG)
const englishLink = `[English](${repository}/blob/main/${EN_CHANGELOG}#${anchor})`
const sections = [englishLink, linkReferences(extractSection(zhChangelog, ZH_CHANGELOG))]

// Link comparisons are only meaningful once a previous release exists. The
// fallback points at the default branch because the very first release
// predates the changelog it is being written into.
const previous = process.env.PREVIOUS_TAG?.trim()
const footer = previous
  ? `**完整变更**：${repository}/compare/${previous}...${tag}`
  : `**变更日志**：${repository}/blob/main/${ZH_CHANGELOG}`

// The workflow sets this to the literal string 'true' only when both the
// signing identity and the certificate are configured.
const macSigned = process.env.MACOS_SIGNED === 'true'
const banner = macSigned ? [] : [UNSIGNED_BANNER]

const body = [...banner, sections.join('\n\n'), '---', footer]
process.stdout.write(`${body.join('\n\n')}\n`)
