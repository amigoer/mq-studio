import { describe, expect, it } from 'vitest'
import type { BrokerNode } from '@generated/models'
import {
  aggregateThroughputHistory,
  continuousHistoryRanges,
  THROUGHPUT_SAMPLE_MS,
} from './throughputHistory'

const NOW = Date.UTC(2026, 6, 22, 12, 0)

describe('aggregateThroughputHistory', () => {
  it('aligns and sums brokers by persisted minute timestamps', () => {
    const earlier = (NOW - THROUGHPUT_SAMPLE_MS) / 1000
    const current = NOW / 1000
    const history = aggregateThroughputHistory(
      [
        broker([earlier, current], [10, 20], [4, 8]),
        broker([earlier, current], [3, 5], [2, 1]),
      ],
      NOW,
    )

    expect(history.timestamps).toEqual([NOW - THROUGHPUT_SAMPLE_MS, NOW])
    expect(history.inbound).toEqual([13, 25])
    expect(history.outbound).toEqual([6, 9])
  })

  it('filters expired samples and preserves real gaps', () => {
    const history = aggregateThroughputHistory(
      [
        broker(
          [
            (NOW - 60 * THROUGHPUT_SAMPLE_MS) / 1000,
            (NOW - 10 * THROUGHPUT_SAMPLE_MS) / 1000,
            NOW / 1000,
          ],
          [1, 2, 3],
          [1, 2, 3],
        ),
      ],
      NOW,
    )

    expect(history.timestamps).toEqual([NOW - 10 * THROUGHPUT_SAMPLE_MS, NOW])
    expect(continuousHistoryRanges(history.timestamps)).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
    ])
  })

  it('bridges one missed sample but preserves longer collection gaps', () => {
    const timestamps = [
      NOW - 5 * THROUGHPUT_SAMPLE_MS,
      NOW - 3 * THROUGHPUT_SAMPLE_MS,
      NOW,
    ]

    expect(continuousHistoryRanges(timestamps)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 2 },
    ])
  })

  it('supports history returned by an older daemon without timestamps', () => {
    const legacy = broker([], [4, 7], [2, 3])
    const history = aggregateThroughputHistory([legacy], NOW)

    expect(history.timestamps).toEqual([NOW - THROUGHPUT_SAMPLE_MS, NOW])
    expect(history.inbound).toEqual([4, 7])
  })
})

function broker(timestamps: number[], inbound: number[], outbound: number[]): BrokerNode {
  return {
    tpsHistoryTimestamps: timestamps,
    tpsInHistory: inbound,
    tpsOutHistory: outbound,
  } as BrokerNode
}
