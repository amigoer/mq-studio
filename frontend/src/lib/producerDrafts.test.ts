import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearProducerDraft,
  loadProducerScope,
  saveProducerDraft,
  type ProducerDraft,
} from './producerDrafts'

const KEY = 'mq-studio:producer-drafts'

function draft(overrides: Partial<ProducerDraft> = {}): ProducerDraft {
  return { tag: 'order.create', key: 'ORD-1', delay: 3, body: '{"a":1}', ...overrides }
}

describe('producerDrafts storage', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns an empty scope when nothing is stored', () => {
    expect(loadProducerScope('c1:localhost:9876')).toEqual({ lastTopic: '', drafts: {} })
  })

  it('round-trips a draft and marks the topic as last used', () => {
    saveProducerDraft('c1', 'TopicA', draft())
    const scope = loadProducerScope('c1')
    expect(scope.lastTopic).toBe('TopicA')
    expect(scope.drafts.TopicA).toEqual(draft())
    expect(store.get(KEY)).toBeTruthy()
  })

  it('keeps each topic separate and moves lastTopic to the newest send', () => {
    saveProducerDraft('c1', 'TopicA', draft({ body: 'A' }))
    saveProducerDraft('c1', 'TopicB', draft({ body: 'B' }))
    const scope = loadProducerScope('c1')
    expect(scope.lastTopic).toBe('TopicB')
    expect(scope.drafts.TopicA?.body).toBe('A')
    expect(scope.drafts.TopicB?.body).toBe('B')
  })

  it('does not leak drafts across connections', () => {
    saveProducerDraft('c1', 'TopicA', draft({ body: 'from c1' }))
    saveProducerDraft('c2', 'TopicA', draft({ body: 'from c2' }))
    expect(loadProducerScope('c1').drafts.TopicA?.body).toBe('from c1')
    expect(loadProducerScope('c2').drafts.TopicA?.body).toBe('from c2')
  })

  it('ignores an empty topic', () => {
    saveProducerDraft('c1', '', draft())
    expect(loadProducerScope('c1')).toEqual({ lastTopic: '', drafts: {} })
  })

  it('clears only the target topic and leaves lastTopic alone', () => {
    saveProducerDraft('c1', 'TopicA', draft({ body: 'A' }))
    saveProducerDraft('c1', 'TopicB', draft({ body: 'B' }))
    const scope = clearProducerDraft('c1', 'TopicB')
    expect(scope.drafts.TopicB).toBeUndefined()
    expect(scope.drafts.TopicA?.body).toBe('A')
    expect(scope.lastTopic).toBe('TopicB')
    expect(loadProducerScope('c1').drafts.TopicB).toBeUndefined()
  })

  it('clearing an unknown topic is a no-op', () => {
    saveProducerDraft('c1', 'TopicA', draft())
    expect(clearProducerDraft('c1', 'Nope').drafts.TopicA).toBeDefined()
    expect(clearProducerDraft('missing-scope', 'TopicA')).toEqual({ lastTopic: '', drafts: {} })
  })

  it('evicts the least recently saved topics past the cap', () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000))
    for (let i = 0; i < 33; i += 1) {
      saveProducerDraft('c1', `Topic${i}`, draft({ body: String(i) }))
    }
    const scope = loadProducerScope('c1')
    expect(Object.keys(scope.drafts)).toHaveLength(30)
    expect(scope.drafts.Topic0).toBeUndefined()
    expect(scope.drafts.Topic2).toBeUndefined()
    expect(scope.drafts.Topic3).toBeDefined()
    expect(scope.drafts.Topic32).toBeDefined()
  })

  it('evicts the least recently used connections past the cap', () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000))
    for (let i = 0; i < 12; i += 1) {
      saveProducerDraft(`c${i}`, 'TopicA', draft())
    }
    expect(loadProducerScope('c0').drafts.TopicA).toBeUndefined()
    expect(loadProducerScope('c1').drafts.TopicA).toBeUndefined()
    expect(loadProducerScope('c2').drafts.TopicA).toBeDefined()
    expect(loadProducerScope('c11').drafts.TopicA).toBeDefined()
  })

  it('skips an oversized body and keeps the previous content', () => {
    saveProducerDraft('c1', 'TopicA', draft({ body: 'small' }))
    const scope = saveProducerDraft('c1', 'TopicA', draft({ body: 'x'.repeat(256 * 1024 + 1) }))
    expect(scope.drafts.TopicA?.body).toBe('small')
    expect(scope.lastTopic).toBe('TopicA')
  })

  it('clamps the delay level on write and on read', () => {
    saveProducerDraft('c1', 'TopicA', draft({ delay: 99 }))
    expect(loadProducerScope('c1').drafts.TopicA?.delay).toBe(18)
    const stored = { c2: { lastTopic: 'T', drafts: { T: { ...draft(), delay: -5 } } } }
    store.set(KEY, JSON.stringify(stored))
    expect(loadProducerScope('c2').drafts.T?.delay).toBe(0)
  })

  it('falls back to an empty scope on corrupt or mistyped data', () => {
    store.set(KEY, 'not json')
    expect(loadProducerScope('c1')).toEqual({ lastTopic: '', drafts: {} })

    store.set(KEY, JSON.stringify({ c1: { lastTopic: 7, drafts: { T: { tag: 1 }, U: null } } }))
    expect(loadProducerScope('c1')).toEqual({ lastTopic: '', drafts: {} })
  })
})
