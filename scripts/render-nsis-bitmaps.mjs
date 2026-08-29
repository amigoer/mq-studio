// Renders the NSIS installer artwork from SVG to the BMPs MUI expects.
//
// Both must be 24-bit BMP3: a 32-bit BMP with an alpha channel renders with a
// black band on several Windows versions.
//
// Usage: node scripts/render-nsis-bitmaps.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'build/windows/nsis/resources')

// Sizes are fixed by NSIS: MUI rejects anything else.
const TARGETS = [
  { name: 'welcome', width: 164, height: 314 },
  { name: 'header', width: 150, height: 57 },
]

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find((path) => {
  try {
    execFileSync('test', ['-x', path])
    return true
  } catch {
    return false
  }
})

if (!CHROME) {
  throw new Error('no Chromium-based browser found; install Google Chrome to regenerate')
}

const work = mkdtempSync(resolve(tmpdir(), 'nsis-bmp-'))

try {
  for (const { name, width, height } of TARGETS) {
    const svg = readFileSync(resolve(dir, `${name}.svg`), 'utf8')
    const page = resolve(work, `${name}.html`)
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}svg{display:block}</style>
${svg.replace(/<\?xml[^>]*\?>/, '')}`,
    )

    const shot = resolve(work, `${name}.png`)
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      `--window-size=${width},${height}`,
      '--force-device-scale-factor=1',
      `--screenshot=${shot}`,
      `file://${page}`,
    ], { stdio: 'pipe' })

    const out = resolve(dir, `${name}.bmp`)
    execFileSync('magick', [
      shot,
      '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
      '-type', 'TrueColor', '-depth', '8', '-strip',
      `BMP3:${out}`,
    ])
    console.log(`${out} (${width}x${height})`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
