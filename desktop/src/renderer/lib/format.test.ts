import { describe, expect, it } from 'vitest'
import {
  formatCompactCount,
  formatCount,
  formatQueues,
  formatRate,
  formatRateWithUnit,
} from './format'

describe('unreported metrics', () => {
  it('renders a dash rather than zero', () => {
    for (const format of [formatRate, formatRateWithUnit, formatCount, formatCompactCount]) {
      expect(format(-1)).toBe('—')
      expect(format(Number.NaN)).toBe('—')
      expect(format(Number.POSITIVE_INFINITY)).toBe('—')
    }
  })

  it('keeps a real zero reading distinct from a missing one', () => {
    expect(formatRate(0)).toBe('0')
    expect(formatRateWithUnit(0)).toBe('0/s')
    expect(formatCount(0)).toBe('0')
  })
})

describe('formatRate', () => {
  it('rounds small values', () => {
    expect(formatRate(12.4)).toBe('12')
    expect(formatRate(999)).toBe('999')
  })

  it('collapses thousands with two decimals, ten-thousands with one', () => {
    expect(formatRate(1000)).toBe('1.00k')
    expect(formatRate(1234)).toBe('1.23k')
    expect(formatRate(9999)).toBe('10.00k')
    expect(formatRate(10000)).toBe('10.0k')
    expect(formatRate(123456)).toBe('123.5k')
  })

  it('appends the unit only in the with-unit variant', () => {
    expect(formatRateWithUnit(1234)).toBe('1.23k/s')
  })
})

describe('formatCount', () => {
  it('never collapses, so exact totals stay exact', () => {
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})

describe('formatCompactCount', () => {
  it('stays exact below ten thousand and collapses above', () => {
    expect(formatCompactCount(9999)).toBe('9,999')
    expect(formatCompactCount(10000)).toBe('10.0k')
  })
})

describe('formatQueues', () => {
  it('reports each side independently', () => {
    expect(formatQueues(8, 8)).toBe('8 / 8')
    expect(formatQueues(-1, 8)).toBe('— / 8')
    expect(formatQueues(8, -1)).toBe('8 / —')
    expect(formatQueues(-1, -1)).toBe('—')
  })

  it('keeps a zero queue count visible', () => {
    expect(formatQueues(0, 4)).toBe('0 / 4')
  })
})
