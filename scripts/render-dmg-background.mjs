// Renders build/darwin/dmg/background.svg to the 1x and 2x PNGs the DMG uses.
//
// Chrome does the rasterising because the SVG carries text and gradients: the
// locally available ImageMagick has no librsvg delegate and its built-in MSVG
// renderer gets both wrong.
//
// Usage: node scripts/render-dmg-background.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dmgDir = resolve(root, 'build/darwin/dmg')

// The unsigned variant is taller because it carries the First Run helper.
const TARGETS = [
  { name: 'background', width: 600, height: 400 },
  { name: 'background-unsigned', width: 600, height: 560 },
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

const work = mkdtempSync(resolve(tmpdir(), 'dmg-bg-'))

try {
  for (const { name, width, height } of TARGETS) {
    const svg = readFileSync(resolve(dmgDir, `${name}.svg`), 'utf8')

    // Wrapping the SVG in a zero-margin page keeps the screenshot free of the
    // document padding Chrome adds around a bare .svg URL.
    const page = resolve(work, `${name}.html`)
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}svg{display:block}</style>
${svg.replace(/<\?xml[^>]*\?>/, '')}`,
    )

    for (const scale of [1, 2]) {
      const shot = resolve(work, `${name}@${scale}.shot.png`)
      execFileSync(CHROME, [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-sandbox',
        `--window-size=${width},${height}`,
        `--force-device-scale-factor=${scale}`,
        `--screenshot=${shot}`,
        `file://${page}`,
      ], { stdio: 'pipe' })

      // Finder composites a translucent background unpredictably, so the
      // shipped PNGs are flattened onto white with the alpha channel dropped.
      const out = resolve(dmgDir, scale === 1 ? `${name}.png` : `${name}@2x.png`)
      execFileSync('magick', [shot, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-strip', out])
      console.log(`${out} (${width * scale}x${height * scale})`)
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
