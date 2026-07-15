/**
 * Codemod: replace rl-btn / rl-input / rl-select / rl-badge with shadcn components.
 * Correctly parses JSX open tags so `=>` inside props does not break matching.
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

/** Index of `>` that ends a JSX open tag starting at `start` (`<` position). */
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

function ensureImport(src, symbol, from) {
  // Only match single-line imports
  const re = new RegExp(
    `^import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*;?$`,
    'm',
  )
  const m = src.match(re)
  if (m) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (names.some((n) => n === symbol || n.startsWith(symbol + ' '))) return src
    return src.replace(re, `import { ${[...names, symbol].join(', ')} } from '${from}'`)
  }
  // Insert after last top-level import line (not inside multi-line import body)
  const lines = src.split('\n')
  let last = -1
  let inMulti = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^import\s/.test(line)) {
      inMulti = !line.includes(' from ') && line.includes('{') && !line.includes('}')
      last = i
    } else if (inMulti) {
      last = i
      if (line.includes(' from ') || line.includes('}')) inMulti = false
    }
  }
  const line = `import { ${symbol} } from '${from}'`
  if (last >= 0) {
    lines.splice(last + 1, 0, line)
    return lines.join('\n')
  }
  return `${line}\n${src}`
}

function parseBtn(cls) {
  const parts = cls.split(/\s+/).filter(Boolean)
  let variant = 'ghost'
  let size = 'default'
  const rest = []
  let hasVariant = false
  for (const p of parts) {
    if (p === 'rl-btn') continue
    if (p === 'rl-btn-primary') {
      variant = 'default'
      hasVariant = true
    } else if (p === 'rl-btn-outline') {
      variant = 'outline'
      hasVariant = true
    } else if (p === 'rl-btn-ghost') {
      variant = 'ghost'
      hasVariant = true
    } else if (p === 'rl-btn-destructive') {
      variant = 'destructive'
      hasVariant = true
    } else if (p === 'rl-btn-sm') size = size.startsWith('icon') ? 'icon-sm' : 'sm'
    else if (p === 'rl-btn-icon') size = size === 'sm' || size === 'icon-sm' ? 'icon-sm' : 'icon'
    else rest.push(p)
  }
  if (!hasVariant) variant = 'ghost'
  return { variant, size, rest: rest.join(' ') }
}

function getClassName(openTag) {
  const m = openTag.match(/\bclassName="([^"]*)"/)
  return m ? m[1] : null
}

function setClassName(openTag, next) {
  if (next) {
    if (/\bclassName="/.test(openTag)) return openTag.replace(/\bclassName="[^"]*"/, `className="${next}"`)
    return openTag.replace(/>$/, ` className="${next}">`)
  }
  return openTag.replace(/\s*className="[^"]*"/, '')
}

function transform(src) {
  let out = src
  const used = new Set()

  // --- buttons ---
  {
    let result = ''
    let cursor = 0
    const re = /<button\b/g
    let m
    while ((m = re.exec(out))) {
      const start = m.index
      const end = findOpenTagEnd(out, start)
      if (end < 0) break
      const open = out.slice(start, end + 1)
      const selfClose = open.endsWith('/>')
      const cls = getClassName(open)
      if (!cls || !cls.includes('rl-btn')) continue

      result += out.slice(cursor, start)
      const { variant, size, rest } = parseBtn(cls)
      used.add('Button')
      let newOpen = open.replace(/^<button\b/, '<Button')
      newOpen = setClassName(newOpen, rest)
      // inject variant/size after <Button
      newOpen = newOpen.replace(
        /^<Button\b/,
        `<Button variant="${variant}" size="${size}"`,
      )

      if (selfClose) {
        result += newOpen
        cursor = end + 1
        re.lastIndex = cursor
        continue
      }

      // find matching </button>
      let depth = 1
      let i = end + 1
      while (i < out.length && depth > 0) {
        const nextOpen = out.indexOf('<button', i)
        const nextClose = out.indexOf('</button>', i)
        if (nextClose < 0) break
        if (nextOpen >= 0 && nextOpen < nextClose) {
          depth++
          i = nextOpen + 7
        } else {
          depth--
          if (depth === 0) {
            const children = out.slice(end + 1, nextClose)
            result += newOpen + children + '</Button>'
            cursor = nextClose + '</button>'.length
            re.lastIndex = cursor
            break
          }
          i = nextClose + 9
        }
      }
      if (depth !== 0) {
        // abort this match
        result += out.slice(start, end + 1)
        cursor = end + 1
        re.lastIndex = cursor
      }
    }
    result += out.slice(cursor)
    out = result
  }

  // --- inputs ---
  {
    let result = ''
    let cursor = 0
    const re = /<input\b/g
    let m
    while ((m = re.exec(out))) {
      const start = m.index
      const end = findOpenTagEnd(out, start)
      if (end < 0) break
      const open = out.slice(start, end + 1)
      const cls = getClassName(open)
      if (!cls || !cls.includes('rl-input')) continue
      result += out.slice(cursor, start)
      used.add('Input')
      const rest = cls
        .split(/\s+/)
        .filter((p) => p && p !== 'rl-input')
        .join(' ')
      let newOpen = open.replace(/^<input\b/, '<Input')
      newOpen = setClassName(newOpen, rest)
      if (!newOpen.endsWith('/>')) {
        newOpen = newOpen.replace(/>$/, ' />')
      }
      result += newOpen
      cursor = end + 1
      re.lastIndex = cursor
    }
    result += out.slice(cursor)
    out = result
  }

  // --- select ---
  {
    let result = ''
    let cursor = 0
    const re = /<select\b/g
    let m
    while ((m = re.exec(out))) {
      const start = m.index
      const end = findOpenTagEnd(out, start)
      if (end < 0) break
      const open = out.slice(start, end + 1)
      const cls = getClassName(open)
      if (!cls || !cls.includes('rl-select')) continue
      const close = out.indexOf('</select>', end)
      if (close < 0) continue
      result += out.slice(cursor, start)
      used.add('Select')
      const rest = cls
        .split(/\s+/)
        .filter((p) => p && p !== 'rl-select')
        .join(' ')
      let newOpen = open.replace(/^<select\b/, '<Select')
      newOpen = setClassName(newOpen, rest)
      const children = out.slice(end + 1, close)
      result += newOpen + children + '</Select>'
      cursor = close + '</select>'.length
      re.lastIndex = cursor
    }
    result += out.slice(cursor)
    out = result
  }

  // --- textarea with rl-input ---
  {
    let result = ''
    let cursor = 0
    const re = /<textarea\b/g
    let m
    while ((m = re.exec(out))) {
      const start = m.index
      const end = findOpenTagEnd(out, start)
      if (end < 0) break
      const open = out.slice(start, end + 1)
      const cls = getClassName(open)
      if (!cls || !cls.includes('rl-input')) continue
      const close = out.indexOf('</textarea>', end)
      if (close < 0) continue
      result += out.slice(cursor, start)
      used.add('Textarea')
      const rest = cls
        .split(/\s+/)
        .filter((p) => p && p !== 'rl-input')
        .join(' ')
      let newOpen = open.replace(/^<textarea\b/, '<Textarea')
      newOpen = setClassName(newOpen, rest)
      result += newOpen + out.slice(end + 1, close) + '</Textarea>'
      cursor = close + '</textarea>'.length
      re.lastIndex = cursor
    }
    result += out.slice(cursor)
    out = result
  }

  // --- badges (span only, no nested span) ---
  {
    let result = ''
    let cursor = 0
    const re = /<span\b/g
    let m
    while ((m = re.exec(out))) {
      const start = m.index
      const end = findOpenTagEnd(out, start)
      if (end < 0) break
      const open = out.slice(start, end + 1)
      const cls = getClassName(open)
      if (!cls || !cls.includes('rl-badge')) continue
      const close = out.indexOf('</span>', end)
      if (close < 0) continue
      const children = out.slice(end + 1, close)
      if (/<span\b/.test(children)) continue
      result += out.slice(cursor, start)
      used.add('Badge')
      const parts = cls.split(/\s+/).filter(Boolean)
      let variant = 'secondary'
      const rest = []
      for (const p of parts) {
        if (p === 'rl-badge') continue
        else if (p === 'rl-badge-success') variant = 'success'
        else if (p === 'rl-badge-warn') variant = 'warning'
        else if (p === 'rl-badge-danger') variant = 'destructive'
        else if (p === 'rl-badge-outline') variant = 'outline'
        else rest.push(p)
      }
      let newOpen = open.replace(/^<span\b/, `<Badge variant="${variant}"`)
      newOpen = setClassName(newOpen, rest.join(' '))
      result += newOpen + children + '</Badge>'
      cursor = close + '</span>'.length
      re.lastIndex = cursor
    }
    result += out.slice(cursor)
    out = result
  }

  if (used.has('Button')) out = ensureImport(out, 'Button', '@/components/ui/button')
  if (used.has('Input')) out = ensureImport(out, 'Input', '@/components/ui/input')
  if (used.has('Select')) out = ensureImport(out, 'Select', '@/components/ui/select')
  if (used.has('Textarea')) out = ensureImport(out, 'Textarea', '@/components/ui/textarea')
  if (used.has('Badge')) out = ensureImport(out, 'Badge', '@/components/ui/badge')

  return out
}

let n = 0
for (const f of walk(root)) {
  const before = readFileSync(f, 'utf8')
  const after = transform(before)
  if (after !== before) {
    writeFileSync(f, after)
    n++
    console.log('updated', f.slice(root.length + 1))
  }
}
console.log(`done: ${n} files`)
