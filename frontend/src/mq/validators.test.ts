import { describe, expect, it } from 'vitest'
import { registerValidator, validate } from './validators'

describe('form validators', () => {
  it('accepts a field with no validator named', () => {
    expect(validate(undefined, '')).toBe(true)
  })

  // A descriptor naming a validator this build does not have must not make the
  // field unfillable; the backend validates again regardless.
  it('passes an unknown validator rather than blocking the field', () => {
    expect(validate('not-built-yet', 'anything')).toBe(true)
  })

  it('runs a builtin check', () => {
    expect(validate('int-range', '12')).toBe(true)
    expect(validate('int-range', 'abc')).toBe(false)
  })

  it('runs a driver-registered check', () => {
    registerValidator('only-ok', (value) => value === 'ok')
    expect(validate('only-ok', 'ok')).toBe(true)
    expect(validate('only-ok', 'no')).toBe(false)
  })
})
