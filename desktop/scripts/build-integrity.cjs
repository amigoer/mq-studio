const { createHash } = require('node:crypto')
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { join, relative, resolve } = require('node:path')
const { verifyDaemonBuild } = require('../../scripts/daemon-build-metadata.cjs')

const projectDir = resolve(__dirname, '..')
const outputDir = join(projectDir, 'out')
const metadataPath = join(outputDir, 'build-metadata.json')

function collectFiles(path) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.DS_Store') return []
    return collectFiles(join(path, entry.name))
  })
}

function sourceFiles() {
  return [
    ...collectFiles(join(projectDir, 'src')),
    join(projectDir, 'electron-builder.yml'),
    join(projectDir, 'electron.vite.config.ts'),
    join(projectDir, 'package-lock.json'),
    join(projectDir, 'package.json'),
    join(projectDir, 'postcss.config.js'),
    join(projectDir, 'scripts', 'build-integrity.cjs'),
    join(projectDir, 'tailwind.config.js'),
    join(projectDir, 'tsconfig.app.json'),
    join(projectDir, 'tsconfig.json'),
    join(projectDir, 'tsconfig.node.json'),
  ].sort()
}

function filesFingerprint(paths, baseDir) {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(relative(baseDir, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function sourceFingerprint() {
  return filesFingerprint(sourceFiles(), projectDir)
}

function outputFingerprint() {
  const files = collectFiles(outputDir)
    .filter((path) => path !== metadataPath)
    .sort()
  return filesFingerprint(files, outputDir)
}

function packageVersion() {
  return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version
}

function requireBuildOutputs() {
  for (const path of [
    join(outputDir, 'main', 'index.js'),
    join(outputDir, 'preload', 'index.js'),
    join(outputDir, 'renderer', 'index.html'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop build output is missing: ${path}`)
  }
}

function assertNoLegacyCopy() {
  const forbidden = [
    'built with Go and Wails',
    '基于 Wails',
    'built with Electron and a local Go daemon',
    '基于 Electron 与本地 Go daemon',
  ]
  for (const path of collectFiles(join(outputDir, 'renderer'))) {
    if (!path.endsWith('.js') && !path.endsWith('.html')) continue
    const content = readFileSync(path, 'utf8')
    for (const phrase of forbidden) {
      if (content.includes(phrase)) {
        throw new Error(`legacy product copy found in desktop output: ${phrase}`)
      }
    }
  }
}

function writeMetadata() {
  requireBuildOutputs()
  assertNoLegacyCopy()
  const metadata = {
    version: packageVersion(),
    sourceFingerprint: sourceFingerprint(),
    outputFingerprint: outputFingerprint(),
  }
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  console.log(`desktop build metadata written for ${metadata.version}`)
}

function verifyMetadata() {
  requireBuildOutputs()
  if (!existsSync(metadataPath)) {
    throw new Error('desktop build metadata is missing; run npm run build before packaging')
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  const version = packageVersion()
  if (metadata.version !== version) {
    throw new Error(`desktop output version ${metadata.version} does not match package version ${version}`)
  }
  const fingerprint = sourceFingerprint()
  if (metadata.sourceFingerprint !== fingerprint) {
    throw new Error('desktop source changed after the last build; rebuild before packaging')
  }
  if (metadata.outputFingerprint !== outputFingerprint()) {
    throw new Error('desktop output changed after the last build; rebuild before packaging')
  }
  assertNoLegacyCopy()
  console.log(`desktop build integrity verified for ${version}`)
}

exports.default = async function beforePack(context) {
  verifyMetadata()
  const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[context.electronPlatformName]
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!platform || !arch) {
    throw new Error(
      `unsupported packaging target: ${context.electronPlatformName}/${String(context.arch)}`,
    )
  }
  verifyDaemonBuild(platform, arch, packageVersion())
}
exports.verifyMetadata = verifyMetadata
exports.writeMetadata = writeMetadata

if (require.main === module) {
  const action = process.argv[2]
  if (action === 'write') writeMetadata()
  else if (action === 'verify') verifyMetadata()
  else throw new Error('usage: node scripts/build-integrity.cjs <write|verify>')
}
