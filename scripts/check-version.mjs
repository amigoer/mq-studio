import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function read(path) {
  return readFile(resolve(root, path), 'utf8')
}

async function readJSON(path) {
  return JSON.parse(await read(path))
}

const [rootPackage, rootLock, frontendPackage, frontendLock, buildConfig] = await Promise.all([
  readJSON('package.json'),
  readJSON('package-lock.json'),
  readJSON('frontend/package.json'),
  readJSON('frontend/package-lock.json'),
  read('build/config.yml'),
])

const canonicalVersion = rootPackage.version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(canonicalVersion)) {
  throw new Error(`package.json contains an invalid SemVer: ${canonicalVersion}`)
}

// build/config.yml feeds the platform manifests and the -ldflags app version.
const buildConfigVersion = /^\s{2}version:\s*"(.+)"\s*$/m.exec(buildConfig)?.[1]

const mirrors = new Map([
  ['package-lock.json', rootLock.version],
  ['package-lock.json packages[""]', rootLock.packages?.['']?.version],
  ['frontend/package.json', frontendPackage.version],
  ['frontend/package-lock.json', frontendLock.version],
  ['frontend/package-lock.json packages[""]', frontendLock.packages?.['']?.version],
  ['build/config.yml info.version', buildConfigVersion],
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
