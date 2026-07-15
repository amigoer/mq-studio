import { describe, expect, it } from 'vitest'
import { formatErrorMessage, withMinDuration } from './utils'

describe('formatErrorMessage', () => {
  it('reads message field from objects', () => {
    expect(formatErrorMessage({ message: 'boom' })).toBe('boom')
  })

  it('unwraps JSON error strings', () => {
    expect(formatErrorMessage('{"message":"from-json"}')).toBe('from-json')
  })

  it('uses Error.message', () => {
    expect(formatErrorMessage(new Error('plain'))).toBe('plain')
  })

  it('stringifies plain values when no message field exists', () => {
    expect(formatErrorMessage(123)).toBe('123')
    expect(formatErrorMessage(null)).toBe('null')
  })
})

describe('withMinDuration', () => {
  it('resolves the underlying value', async () => {
    const value = await withMinDuration(Promise.resolve(42), 0)
    expect(value).toBe(42)
  })

  it('waits at least minMs', async () => {
    const started = Date.now()
    await withMinDuration(Promise.resolve('ok'), 30)
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })
})
