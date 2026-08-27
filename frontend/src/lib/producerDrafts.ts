/** The message content last sent to one topic, minus the topic itself (it is the map key). */
export interface ProducerDraft {
  tag: string
  key: string
  delay: number
  body: string
}

/** Everything remembered for a single connection. */
export interface ProducerScope {
  lastTopic: string
  drafts: Record<string, ProducerDraft>
}

const STORAGE_KEY = 'mq-studio:producer-drafts'

/** Bodies past this size are not the kind anyone retypes, and localStorage only has ~5 MB total. */
const MAX_BODY_BYTES = 256 * 1024
const MAX_TOPICS_PER_SCOPE = 30
const MAX_SCOPES = 10
const MAX_DELAY_LEVEL = 18

/** `savedAt` drives LRU eviction only, so it stays out of the public shape. */
interface StoredDraft extends ProducerDraft {
  savedAt: number
}

interface StoredScope {
  lastTopic: string
  drafts: Record<string, StoredDraft>
}

type StoredFile = Record<string, StoredScope>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.trunc(value), 0), MAX_DELAY_LEVEL)
}

function bodyBytes(body: string): number {
  return new TextEncoder().encode(body).length
}

function sanitizeDraft(value: unknown): StoredDraft | null {
  if (!isRecord(value)) return null
  const { tag, key, body, savedAt } = value
  if (typeof tag !== 'string' || typeof key !== 'string' || typeof body !== 'string') return null
  return {
    tag,
    key,
    body,
    delay: clampDelay(value.delay),
    savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
  }
}

function sanitizeScope(value: unknown): StoredScope | null {
  if (!isRecord(value)) return null
  const drafts: Record<string, StoredDraft> = {}
  if (isRecord(value.drafts)) {
    for (const [topic, raw] of Object.entries(value.drafts)) {
      const draft = sanitizeDraft(raw)
      if (draft) drafts[topic] = draft
    }
  }
  return {
    lastTopic: typeof value.lastTopic === 'string' ? value.lastTopic : '',
    drafts,
  }
}

function readFile(): StoredFile {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const file: StoredFile = {}
    for (const [scopeKey, value] of Object.entries(parsed)) {
      const scope = sanitizeScope(value)
      if (scope) file[scopeKey] = scope
    }
    return file
  } catch {
    return {}
  }
}

function newestSavedAt(scope: StoredScope): number {
  return Object.values(scope.drafts).reduce((max, draft) => Math.max(max, draft.savedAt), 0)
}

/** Drops the least recently saved entries so the store stays bounded. Mutates `file`. */
function trim(file: StoredFile): StoredFile {
  for (const scope of Object.values(file)) {
    const entries = Object.entries(scope.drafts)
    if (entries.length <= MAX_TOPICS_PER_SCOPE) continue
    entries.sort((a, b) => b[1].savedAt - a[1].savedAt)
    scope.drafts = Object.fromEntries(entries.slice(0, MAX_TOPICS_PER_SCOPE))
  }
  const scopes = Object.entries(file)
  if (scopes.length <= MAX_SCOPES) return file
  scopes.sort((a, b) => newestSavedAt(b[1]) - newestSavedAt(a[1]))
  return Object.fromEntries(scopes.slice(0, MAX_SCOPES))
}

function writeFile(file: StoredFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
  } catch {
    // ignore quota / private mode
  }
}

function toScope(stored: StoredScope | undefined): ProducerScope {
  if (!stored) return { lastTopic: '', drafts: {} }
  const drafts: Record<string, ProducerDraft> = {}
  for (const [topic, draft] of Object.entries(stored.drafts)) {
    drafts[topic] = { tag: draft.tag, key: draft.key, delay: draft.delay, body: draft.body }
  }
  return { lastTopic: stored.lastTopic, drafts }
}

/** Reads everything remembered for one connection. */
export function loadProducerScope(scopeKey: string): ProducerScope {
  return toScope(readFile()[scopeKey])
}

/**
 * Records what was just sent to `topic` and marks it as the topic to reopen on.
 * An oversized body is skipped rather than truncated — half a JSON payload is worse than none.
 */
export function saveProducerDraft(
  scopeKey: string,
  topic: string,
  draft: ProducerDraft,
): ProducerScope {
  if (!topic) return loadProducerScope(scopeKey)
  const file = readFile()
  const scope = file[scopeKey] ?? { lastTopic: '', drafts: {} }
  scope.lastTopic = topic
  if (bodyBytes(draft.body) <= MAX_BODY_BYTES) {
    scope.drafts[topic] = {
      tag: draft.tag,
      key: draft.key,
      delay: clampDelay(draft.delay),
      body: draft.body,
      savedAt: Date.now(),
    }
  }
  file[scopeKey] = scope
  const trimmed = trim(file)
  writeFile(trimmed)
  return toScope(trimmed[scopeKey])
}

/** Forgets one topic's content. `lastTopic` is left alone so the form keeps its selection. */
export function clearProducerDraft(scopeKey: string, topic: string): ProducerScope {
  const file = readFile()
  const scope = file[scopeKey]
  if (!scope || !(topic in scope.drafts)) return toScope(scope)
  delete scope.drafts[topic]
  writeFile(file)
  return toScope(scope)
}
