import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function readJSON(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'))
}

const [rootPackage, rootLock, desktopPackage, desktopLock] = await Promise.all([
  readJSON('package.json'),
  readJSON('package-lock.json'),
  readJSON('desktop/package.json'),
  readJSON('desktop/package-lock.json'),
])

const canonicalVersion = desktopPackage.version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(canonicalVersion)) {
  throw new Error(`desktop/package.json contains an invalid SemVer: ${canonicalVersion}`)
}

const mirrors = new Map([
  ['package.json', rootPackage.version],
  ['package-lock.json', rootLock.version],
  ['package-lock.json packages[""]', rootLock.packages?.['']?.version],
  ['desktop/package-lock.json', desktopLock.version],
  ['desktop/package-lock.json packages[""]', desktopLock.packages?.['']?.version],
])

for (const [source, version] of mirrors) {
  if (version !== canonicalVersion) {
    throw new Error(`${source} version ${String(version)} does not match ${canonicalVersion}`)
  }
}

const requestedTag = process.env.RELEASE_TAG ?? process.argv[2]
if (requestedTag && requestedTag !== `v${canonicalVersion}`) {
  throw new Error(`release tag ${requestedTag} does not match v${canonicalVersion}`)
}

console.log(`version metadata is consistent: ${canonicalVersion}`)
