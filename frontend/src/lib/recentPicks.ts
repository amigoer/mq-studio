/** The two long, cluster-supplied lists a picker can remember. */
export type PickKind = 'topic' | 'group'

const STORAGE_KEY = 'mq-studio:recent-picks'

/** Enough to cover the handful of topics one service is debugged against. */
const MAX_RECENT = 10
const MAX_SCOPES = 10

interface StoredScope {
  topics: string[]
  groups: string[]
  /** Drives LRU eviction across connections. */
  updatedAt: number
}

type StoredFile = Record<string, StoredScope>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '' || out.includes(entry)) continue
    out.push(entry)
    if (out.length === MAX_RECENT) break
  }
  return out
}

function sanitizeScope(value: unknown): StoredScope | null {
  if (!isRecord(value)) return null
  return {
    topics: sanitizeList(value.topics),
    groups: sanitizeList(value.groups),
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
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

/** Drops the least recently used connections so the store stays bounded. */
function trim(file: StoredFile): StoredFile {
  const scopes = Object.entries(file)
  if (scopes.length <= MAX_SCOPES) return file
  scopes.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return Object.fromEntries(scopes.slice(0, MAX_SCOPES))
}

function writeFile(file: StoredFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
  } catch {
    // ignore quota / private mode
  }
}

function listOf(scope: StoredScope, kind: PickKind): string[] {
  return kind === 'topic' ? scope.topics : scope.groups
}

/** Reads the most-recently-used values of one kind on one connection, newest first. */
export function loadRecentPicks(scopeKey: string, kind: PickKind): string[] {
  const scope = readFile()[scopeKey]
  return scope ? listOf(scope, kind) : []
}

/**
 * Moves `value` to the front of the list and persists it.
 * Returns the new list so callers can hand it straight to `setState`.
 */
export function recordRecentPick(scopeKey: string, kind: PickKind, value: string): string[] {
  if (!value) return loadRecentPicks(scopeKey, kind)
  const file = readFile()
  const scope = file[scopeKey] ?? { topics: [], groups: [], updatedAt: 0 }
  const next = [value, ...listOf(scope, kind).filter((entry) => entry !== value)].slice(
    0,
    MAX_RECENT,
  )
  if (kind === 'topic') scope.topics = next
  else scope.groups = next
  scope.updatedAt = Date.now()
  file[scopeKey] = scope
  const trimmed = trim(file)
  writeFile(trimmed)
  return next
}
