import { describe, expect, it } from 'vitest'
import { filterOptions } from './optionFilter'

describe('filterOptions', () => {
  const topics = ['OrderPaid', 'order-created', 'PaymentOrderSync', 'StockUpdated']

  it('returns everything, in the given order, for an empty query', () => {
    expect(filterOptions(topics, '')).toEqual({ items: topics, hidden: 0 })
    expect(filterOptions(topics, '   ')).toEqual({ items: topics, hidden: 0 })
  })

  it('matches case-insensitively anywhere in the name', () => {
    expect(filterOptions(topics, 'ORDER').items).toEqual([
      'OrderPaid',
      'order-created',
      'PaymentOrderSync',
    ])
  })

  it('ranks exact over prefix over substring', () => {
    const options = ['a-order', 'order-b', 'order']
    expect(filterOptions(options, 'order').items).toEqual(['order', 'order-b', 'a-order'])
  })

  it('keeps the caller order within one rank', () => {
    expect(filterOptions(['b-x', 'a-x'], 'x').items).toEqual(['b-x', 'a-x'])
  })

  it('reports nothing for a query that matches nothing', () => {
    expect(filterOptions(topics, 'zzz')).toEqual({ items: [], hidden: 0 })
  })

  it('caps the result and counts what it left out', () => {
    const many = Array.from({ length: 250 }, (_, i) => `Topic-${i}`)
    const result = filterOptions(many, '', 200)
    expect(result.items).toHaveLength(200)
    expect(result.hidden).toBe(50)

    const filtered = filterOptions(many, 'Topic-1', 5)
    expect(filtered.items).toHaveLength(5)
    // Topic-1, Topic-1x and Topic-1xx all match: 1 + 10 + 100 = 111
    expect(filtered.hidden).toBe(106)
  })
})
