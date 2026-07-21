const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { join, relative, resolve } = require('node:path')

const repoRoot = resolve(__dirname, '..')
const daemonRoot = join(repoRoot, 'daemon')
const supportedPlatforms = new Set(['mac', 'win', 'linux'])
const supportedArchitectures = new Set(['x64', 'arm64'])
const modulePath = 'github.com/amigoer/rocket-leaf/daemon/cmd/rocket-leafd'

function collectGoFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []
    const child = join(path, entry.name)
    if (entry.isDirectory()) return collectGoFiles(child)
    return entry.isFile() && entry.name.endsWith('.go') ? [child] : []
  })
}

function daemonSourceFiles() {
  return [
    ...collectGoFiles(daemonRoot),
    join(daemonRoot, 'go.mod'),
    join(daemonRoot, 'go.sum'),
    join(repoRoot, 'scripts', 'build-daemon.sh'),
    __filename,
  ].sort()
}

function hashFiles(paths) {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(relative(repoRoot, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function buildPaths(platform, arch) {
  if (!supportedPlatforms.has(platform)) throw new Error(`unsupported daemon platform: ${platform}`)
  if (!supportedArchitectures.has(arch)) throw new Error(`unsupported daemon architecture: ${arch}`)
  const directory = join(repoRoot, 'desktop', 'resources', 'bin', platform, arch)
  return {
    binary: join(directory, platform === 'win' ? 'rocket-leafd.exe' : 'rocket-leafd'),
    metadata: join(directory, 'build-metadata.json'),
  }
}

function expectedGoTarget(platform, arch) {
  return {
    goos: { mac: 'darwin', win: 'windows', linux: 'linux' }[platform],
    goarch: { x64: 'amd64', arm64: 'arm64' }[arch],
  }
}

function inspectGoBinary(path) {
  const result = spawnSync('go', ['version', '-m', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(
      `failed to inspect daemon binary ${path}: ${result.error?.message ?? String(result.stderr ?? '').trim()}`,
    )
  }
  const readField = (pattern, label) => {
    const value = pattern.exec(result.stdout)?.[1]
    if (!value) throw new Error(`daemon binary does not report ${label}: ${path}`)
    return value
  }
  return {
    modulePath: readField(/^\s*path\s+(\S+)$/m, 'module path'),
    goos: readField(/^\s*build\s+GOOS=(\S+)$/m, 'GOOS'),
    goarch: readField(/^\s*build\s+GOARCH=(\S+)$/m, 'GOARCH'),
  }
}

function validateBinaryTarget(path, platform, arch) {
  const actual = inspectGoBinary(path)
  const expected = expectedGoTarget(platform, arch)
  if (
    actual.modulePath !== modulePath ||
    actual.goos !== expected.goos ||
    actual.goarch !== expected.goarch
  ) {
    throw new Error(
      `daemon binary target mismatch for ${platform}/${arch}: ` +
        `${actual.modulePath} ${actual.goos}/${actual.goarch}`,
    )
  }
  if (platform !== 'win' && (statSync(path).mode & 0o111) === 0) {
    throw new Error(`daemon binary is not executable: ${path}`)
  }
  return actual
}

function writeDaemonBuildMetadata(platform, arch, version) {
  if (typeof version !== 'string' || version.length === 0) throw new Error('daemon version is missing')
  const paths = buildPaths(platform, arch)
  if (!existsSync(paths.binary) || !statSync(paths.binary).isFile()) {
    throw new Error(`daemon binary is missing: ${paths.binary}`)
  }
  const target = validateBinaryTarget(paths.binary, platform, arch)
  const metadata = {
    version,
    platform,
    arch,
    ...target,
    sourceFingerprint: hashFiles(daemonSourceFiles()),
    binarySha256: hashFile(paths.binary),
  }
  writeFileSync(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  console.log(`daemon build metadata written for ${platform}/${arch} ${version}`)
}

function verifyDaemonBuild(platform, arch, expectedVersion) {
  const paths = buildPaths(platform, arch)
  if (!existsSync(paths.metadata)) {
    throw new Error(`daemon build metadata is missing for ${platform}/${arch}; rebuild the daemon`)
  }
  if (!existsSync(paths.binary) || !statSync(paths.binary).isFile()) {
    throw new Error(`daemon binary is missing: ${paths.binary}`)
  }
  const target = validateBinaryTarget(paths.binary, platform, arch)
  const metadata = JSON.parse(readFileSync(paths.metadata, 'utf8'))
  if (
    metadata.version !== expectedVersion ||
    metadata.platform !== platform ||
    metadata.arch !== arch ||
    metadata.modulePath !== target.modulePath ||
    metadata.goos !== target.goos ||
    metadata.goarch !== target.goarch
  ) {
    throw new Error(`daemon metadata does not match ${platform}/${arch} ${expectedVersion}`)
  }
  if (metadata.sourceFingerprint !== hashFiles(daemonSourceFiles())) {
    throw new Error(`daemon source changed after the ${platform}/${arch} binary was built`)
  }
  if (metadata.binarySha256 !== hashFile(paths.binary)) {
    throw new Error(`daemon binary changed after metadata was written: ${paths.binary}`)
  }
  console.log(`daemon build integrity verified for ${platform}/${arch} ${expectedVersion}`)
}

module.exports = { verifyDaemonBuild, writeDaemonBuildMetadata }

if (require.main === module) {
  const [action, platform, arch, version] = process.argv.slice(2)
  if (action === 'write') writeDaemonBuildMetadata(platform, arch, version)
  else if (action === 'verify') verifyDaemonBuild(platform, arch, version)
  else {
    throw new Error(
      'usage: node scripts/daemon-build-metadata.cjs <write|verify> <platform> <arch> <version>',
    )
  }
}
