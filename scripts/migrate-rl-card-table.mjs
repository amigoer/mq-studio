/**
 * Convert remaining rl-card shells → <Card> and rl-table → <Table> suite.
 * Uses brace/quote-aware open-tag parsing.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../desktop/src/renderer', import.meta.url).pathname

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx') && !p.includes('/components/ui/')) out.push(p)
  }
  return out
}

function findOpenTagEnd(src, start) {
  let i = start + 1
  let quote = null
  let brace = 0
  while (i < src.length) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      i++
      continue
    }
    if (ch === '{') {
      brace++
      i++
      continue
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1)
      i++
      continue
    }
    if (ch === '>' && brace === 0) return i
    i++
  }
  return -1
}

function ensureImport(src, symbols, from) {
  const re = new RegExp(
    `^import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*;?$`,
    'm',
  )
  const m = src.match(re)
  if (m) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const bare = new Set(names.map((n) => n.split(/\s+as\s+/)[0].trim()))
    const add = symbols.filter((s) => !bare.has(s))
    if (add.length === 0) return src
    return src.replace(re, `import { ${[...names, ...add].join(', ')} } from '${from}'`)
  }
  const lines = src.split('\n')
  let last = -1
  let inMulti = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^import\s/.test(line)) {
      last = i
      inMulti = line.includes('{') && !line.includes('}')
    } else if (inMulti) {
      last = i
      if (line.includes('}') || line.includes(' from ')) inMulti = false
    }
  }
  const line = `import { ${symbols.join(', ')} } from '${from}'`
  if (last >= 0) {
    lines.splice(last + 1, 0, line)
    return lines.join('\n')
  }
  return `${line}\n${src}`
}

function getClass(open) {
  const m = open.match(/\bclassName="([^"]*)"/)
  return m ? m[1] : null
}

function setClass(open, next) {
  if (next) {
    if (/\bclassName="/.test(open)) return open.replace(/\bclassName="[^"]*"/, `className="${next}"`)
    return open.replace(/>$/, ` className="${next}">`)
  }
  return open.replace(/\s*\bclassName="[^"]*"/, '')
}

function convertCards(src) {
  let out = ''
  let cursor = 0
  let used = false
  const re = /<(div|section)\b/g
  let m
  while ((m = re.exec(src))) {
    const start = m.index
    const tag = m[1]
    const end = findOpenTagEnd(src, start)
    if (end < 0) break
    const open = src.slice(start, end + 1)
    const cls = getClass(open)
    if (!cls || !/\brl-card\b/.test(cls)) continue

    // match closing tag with depth of same element name
    let depth = 1
    let i = end + 1
    let closeAt = -1
    const openPat = `<${tag}`
    const closePat = `</${tag}>`
    while (i < src.length && depth > 0) {
      const no = src.indexOf(openPat, i)
      const nc = src.indexOf(closePat, i)
      if (nc < 0) break
      // ensure open is a real tag start (not <divSomething)
      const realOpen =
        no >= 0 && no < nc && /[>\s/]/.test(src[no + openPat.length] || '>')
      if (realOpen) {
        const e2 = findOpenTagEnd(src, no)
        if (e2 > 0 && !src.slice(no, e2 + 1).endsWith('/>')) depth++
        i = (e2 > 0 ? e2 : no) + 1
      } else {
        depth--
        if (depth === 0) {
          closeAt = nc
          break
        }
        i = nc + closePat.length
      }
    }
    if (closeAt < 0) continue

    used = true
    out += src.slice(cursor, start)
    const rest = cls
      .split(/\s+/)
      .filter((p) => p && p !== 'rl-card' && p !== 'rl-card-hover')
      .join(' ')
    let newOpen = open.replace(new RegExp(`^<${tag}\\b`), '<Card')
    newOpen = setClass(newOpen, rest)
    out += newOpen + src.slice(end + 1, closeAt) + '</Card>'
    cursor = closeAt + closePat.length
    re.lastIndex = cursor
  }
  out += src.slice(cursor)
  return { src: out, used }
}

function convertTables(src) {
  let out = src
  let used = false

  // <table className="rl-table ..."> → <Table className="...">
  out = out.replace(/<table\b/g, (match, offset) => {
    // we'll do a proper pass instead
    return match
  })

  let result = ''
  let cursor = 0
  const re = /<table\b/g
  let m
  while ((m = re.exec(out))) {
    const start = m.index
    const end = findOpenTagEnd(out, start)
    if (end < 0) break
    const open = out.slice(start, end + 1)
    const cls = getClass(open)
    if (!cls || !/\brl-table\b/.test(cls)) continue
    const close = out.indexOf('</table>', end)
    if (close < 0) continue
    used = true
    result += out.slice(cursor, start)
    const rest = cls
      .split(/\s+/)
      .filter((p) => p && p !== 'rl-table')
      .join(' ')
    // Keep specialty classes like rl-table-topics as className on Table
    let newOpen = open.replace(/^<table\b/, '<Table')
    newOpen = setClass(newOpen, rest || undefined)
    let body = out.slice(end + 1, close)
    // thead/tbody/tr/th/td light conversion if simple
    body = body
      .replace(/<thead\b/g, '<TableHeader')
      .replace(/<\/thead>/g, '</TableHeader>')
      .replace(/<tbody\b/g, '<TableBody')
      .replace(/<\/tbody>/g, '</TableBody>')
      .replace(/<tr\b/g, '<TableRow')
      .replace(/<\/tr>/g, '</TableRow>')
      .replace(/<th\b/g, '<TableHead')
      .replace(/<\/th>/g, '</TableHead>')
      .replace(/<td\b/g, '<TableCell')
      .replace(/<\/td>/g, '</TableCell>')
    result += newOpen + body + '</Table>'
    cursor = close + '</table>'.length
    re.lastIndex = cursor
  }
  result += out.slice(cursor)
  return { src: result, used }
}

let n = 0
for (const f of walk(root)) {
  let src = readFileSync(f, 'utf8')
  const c1 = convertCards(src)
  src = c1.src
  const c2 = convertTables(src)
  src = c2.src
  if (c1.used || c2.used) {
    if (c1.used) src = ensureImport(src, ['Card'], '@/components/ui/card')
    if (c2.used)
      src = ensureImport(
        src,
        ['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell'],
        '@/components/ui/table',
      )
    writeFileSync(f, src)
    n++
    console.log('updated', f.slice(root.length + 1), {
      card: c1.used,
      table: c2.used,
    })
  }
}
console.log('done', n)
