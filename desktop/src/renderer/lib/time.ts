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

/** Detect a reasonable body preview mode for the message detail panel. */
export type BodyPreviewKind = 'json' | 'text' | 'binary'

export function detectBodyKind(body: string): BodyPreviewKind {
  const s = body.trim()
  if (!s) return 'text'
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      JSON.parse(s)
      return 'json'
    } catch {
      // fall through
    }
  }
  // High ratio of non-printable bytes → treat as binary-ish for hex dump.
  let nonPrintable = 0
  const sample = s.slice(0, Math.min(s.length, 512))
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) nonPrintable++
  }
  if (sample.length > 0 && nonPrintable / sample.length > 0.15) return 'binary'
  return 'text'
}

/** Classic hex dump (16 bytes/line) for binary-ish payloads. */
export function toHexDump(body: string, maxBytes = 4096): string {
  const bytes = new TextEncoder().encode(body)
  const limit = Math.min(bytes.length, maxBytes)
  const lines: string[] = []
  for (let i = 0; i < limit; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, limit))
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(16 * 3 - 1, ' ')
    const ascii = Array.from(slice)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
      .join('')
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`)
  }
  if (bytes.length > limit) {
    lines.push(`… (${bytes.length - limit} more bytes)`)
  }
  return lines.join('\n')
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
