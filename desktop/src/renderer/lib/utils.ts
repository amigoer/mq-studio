import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Read message / Message from an object. */
function getMessageFromObject(obj: Record<string, unknown>): string | null {
  const msg = obj['message'] ?? obj['Message']
  if (typeof msg === 'string') {
    const t = msg.trim()
    return t !== '' ? t : null
  }
  return null
}

/** Extract a readable message from JSON or a message-bearing object; never return the raw JSON blob. */
function extractMessageString(value: unknown): string | null {
  if (value == null) return null

  if (typeof value === 'object' && value !== null) {
    const fromObj = getMessageFromObject(value as Record<string, unknown>)
    if (fromObj) {
      // If the extracted value is still a JSON string, parse one more level.
      if (fromObj.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(fromObj) as { message?: string }
          const inner = typeof parsed?.message === 'string' ? parsed.message.trim() : ''
          return inner !== '' ? inner : fromObj
        } catch {
          return fromObj
        }
      }
      return fromObj
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { message?: string; Message?: string }
        const msg = parsed?.message ?? parsed?.Message
        if (typeof msg === 'string') {
          const t = msg.trim()
          return t !== '' ? t : null
        }
      } catch {
        // Not JSON
      }
    }
    return trimmed !== '' ? trimmed : null
  }
  return null
}

/**
 * Ensure a promise takes at least `minMs` so loading UI does not flash off.
 * Used for refresh buttons and other short async actions.
 */
export async function withMinDuration<T>(promise: Promise<T>, minMs = 600): Promise<T> {
  const started = Date.now()
  try {
    return await promise
  } finally {
    const left = minMs - (Date.now() - started)
    if (left > 0) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, left)
      })
    }
  }
}

/** Turn backend/runtime errors into user-readable text without showing raw JSON. */
export function formatErrorMessage(e: unknown): string {
  const fromObj = extractMessageString(e)
  if (fromObj) return fromObj

  if (e instanceof Error) {
    const fromErr = extractMessageString(e.message)
    if (fromErr) return fromErr
    const msg = e.message.trim()
    if (msg.startsWith('{')) {
      const parsed = extractMessageString(msg)
      if (parsed) return parsed
    }
    return msg || 'Operation failed'
  }

  const s = String(e)
  const fromStr = extractMessageString(s)
  if (fromStr) return fromStr
  if (s === '[object Object]') return 'Operation failed'
  return s
}
