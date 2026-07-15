import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { convertIcon } = require('../desktop/node_modules/app-builder-lib/out/util/iconConverter.js')

const [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error('请提供 PNG 输入和 ICNS 输出路径')

const outputDirectory = await mkdtemp(join(tmpdir(), 'rocket-leaf-icns-'))
try {
  await convertIcon({
    sources: [source],
    fallbackSources: [],
    roots: [dirname(fileURLToPath(import.meta.url))],
    format: 'icns',
    outDir: outputDirectory,
  })
  await copyFile(join(outputDirectory, 'icon.icns'), destination)
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}
