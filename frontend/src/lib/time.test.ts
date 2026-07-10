import { describe, expect, it } from 'vitest'
import { detectBodyKind, toHexDump, truncatePayload } from './time'

describe('detectBodyKind', () => {
  it('detects json objects and arrays', () => {
    expect(detectBodyKind('{"a":1}')).toBe('json')
    expect(detectBodyKind('  [1, 2]  ')).toBe('json')
  })

  it('treats invalid braces as text', () => {
    expect(detectBodyKind('{not-json')).toBe('text')
  })

  it('detects binary-ish content', () => {
    const binary = String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7, 8) + 'xx'
    expect(detectBodyKind(binary.repeat(20))).toBe('binary')
  })

  it('treats plain text as text', () => {
    expect(detectBodyKind('hello world')).toBe('text')
    expect(detectBodyKind('')).toBe('text')
  })
})

describe('toHexDump', () => {
  it('formats bytes in 16-column lines', () => {
    const dump = toHexDump('ABC')
    expect(dump).toContain('00000000')
    expect(dump).toContain('41 42 43')
    expect(dump).toContain('|ABC|')
  })

  it('marks truncated tail', () => {
    const dump = toHexDump('abcdefghijklmnopqr', 8)
    expect(dump).toContain('more bytes')
  })
})

describe('truncatePayload', () => {
  it('keeps short bodies intact', () => {
    const r = truncatePayload('hi', 1024)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('hi')
  })

  it('truncates large utf-8 bodies (floor max is 1KB)', () => {
    const body = 'x'.repeat(10_000)
    const r = truncatePayload(body, 100)
    expect(r.truncated).toBe(true)
    expect(r.originalBytes).toBe(10_000)
    // Implementation clamps maxBytes to at least 1024.
    expect(new TextEncoder().encode(r.text).length).toBeLessThanOrEqual(1024)
    expect(r.text.length).toBeLessThan(body.length)
  })
})
