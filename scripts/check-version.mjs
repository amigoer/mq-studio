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

/** Reads the <string> that follows a <key> in a plist. */
function plistString(content, key) {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(content)?.[1]
}

function match(content, pattern) {
  return pattern.exec(content)?.[1]
}

const [
  rootPackage,
  rootLock,
  frontendPackage,
  frontendLock,
  buildConfig,
  infoPlist,
  infoDevPlist,
  windowsInfo,
  windowsNsis,
  windowsManifest,
  nfpm,
] = await Promise.all([
  readJSON('package.json'),
  readJSON('package-lock.json'),
  readJSON('frontend/package.json'),
  readJSON('frontend/package-lock.json'),
  read('build/config.yml'),
  read('build/darwin/Info.plist'),
  read('build/darwin/Info.dev.plist'),
  readJSON('build/windows/info.json'),
  read('build/windows/nsis/wails_tools.nsh'),
  read('build/windows/wails.exe.manifest'),
  read('build/linux/nfpm/nfpm.yaml'),
])

const canonicalVersion = rootPackage.version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(canonicalVersion)) {
  throw new Error(`package.json contains an invalid SemVer: ${canonicalVersion}`)
}

// Hand-edited mirrors of the canonical version.
const authored = new Map([
  ['package-lock.json', rootLock.version],
  ['package-lock.json packages[""]', rootLock.packages?.['']?.version],
  ['frontend/package.json', frontendPackage.version],
  ['frontend/package-lock.json', frontendLock.version],
  ['frontend/package-lock.json packages[""]', frontendLock.packages?.['']?.version],
  ['build/config.yml info.version', match(buildConfig, /^\s{2}version:\s*"(.+)"\s*$/m)],
])

// Platform manifests generated from build/config.yml and committed. They are
// what the packaged artifacts declare to the OS, so a stale one ships the wrong
// version even when every package.json agrees.
const generated = new Map([
  ['build/darwin/Info.plist CFBundleShortVersionString', plistString(infoPlist, 'CFBundleShortVersionString')],
  ['build/darwin/Info.plist CFBundleVersion', plistString(infoPlist, 'CFBundleVersion')],
  ['build/darwin/Info.dev.plist CFBundleShortVersionString', plistString(infoDevPlist, 'CFBundleShortVersionString')],
  ['build/darwin/Info.dev.plist CFBundleVersion', plistString(infoDevPlist, 'CFBundleVersion')],
  ['build/windows/info.json fixed.file_version', windowsInfo.fixed?.file_version],
  ['build/windows/info.json info.ProductVersion', windowsInfo.info?.['0000']?.ProductVersion],
  ['build/windows/nsis/wails_tools.nsh INFO_PRODUCTVERSION', match(windowsNsis, /!define INFO_PRODUCTVERSION "(.+)"/)],
  ['build/windows/wails.exe.manifest assemblyIdentity', match(windowsManifest, /<assemblyIdentity[^>]*\sversion="([^"]+)"/)],
  ['build/linux/nfpm/nfpm.yaml version', match(nfpm, /^version:\s*"(.+)"\s*$/m)],
])

function verify(mirrors, hint) {
  const stale = []
  for (const [source, version] of mirrors) {
    if (version !== canonicalVersion) stale.push(`  ${source}: ${String(version)}`)
  }
  if (stale.length > 0) {
    throw new Error(
      `the following do not match package.json ${canonicalVersion}:\n${stale.join('\n')}\n${hint}`,
    )
  }
}

verify(authored, 'Update them to match.')
verify(
  generated,
  'These are generated: set info.version in build/config.yml, then run\n' +
    '  wails3 task common:update:build-assets',
)

const requestedTag = process.env.RELEASE_TAG ?? process.argv[2]
if (requestedTag && requestedTag !== `v${canonicalVersion}`) {
  throw new Error(`release tag ${requestedTag} does not match v${canonicalVersion}`)
}

console.log(`version metadata is consistent: ${canonicalVersion}`)
