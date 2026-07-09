export type TimezonePref = 'local' | 'utc'
export type TimestampFormatPref = 'datetime' | 'ms'

/**
 * Format a store/born timestamp for display using user preferences.
 * Accepts epoch ms or a preformatted string (falls back to parsing if possible).
 */
export function formatMessageTime(
  input: number | string | null | undefined,
  timezone: TimezonePref = 'local',
  format: TimestampFormatPref = 'datetime',
): string {
  if (input == null || input === '' || input === '-') return '—'

  let ms: number | null = null
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    ms = input
  } else if (typeof input === 'string') {
    const trimmed = input.trim()
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed)
      // Heuristic: 10-digit seconds vs 13-digit ms
      ms = n < 1e12 ? n * 1000 : n
    } else {
      const parsed = Date.parse(trimmed)
      if (!Number.isNaN(parsed)) ms = parsed
    }
  }

  if (ms == null) {
    return typeof input === 'string' ? input : '—'
  }

  if (format === 'ms') {
    return String(ms)
  }

  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'

  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timezone === 'utc' ? 'UTC' : undefined,
  }

  try {
    // en-CA yields YYYY-MM-DD; replace comma if present
    return new Intl.DateTimeFormat('sv-SE', opts).format(d).replace('T', ' ')
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 19)
  }
}

/** Truncate large message bodies for safe rendering. */
export function truncatePayload(
  body: string,
  maxBytes: number,
): { text: string; truncated: boolean; originalBytes: number } {
  const max = Math.max(1024, maxBytes || 512 * 1024)
  // Approximate UTF-16 length check; good enough for UI guardrails
  const originalBytes = new TextEncoder().encode(body).length
  if (originalBytes <= max) {
    return { text: body, truncated: false, originalBytes }
  }
  // Walk code units until encoded size hits max
  let lo = 0
  let hi = body.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const size = new TextEncoder().encode(body.slice(0, mid)).length
    if (size <= max) lo = mid
    else hi = mid - 1
  }
  return {
    text: body.slice(0, lo),
    truncated: true,
    originalBytes,
  }
}
