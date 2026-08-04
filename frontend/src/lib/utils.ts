import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The `fs-*` type scale from tailwind.config.js. tailwind-merge cannot infer
 * custom scale names, and would file `text-fs-12` under text-*colour* — so two
 * competing sizes would both survive a merge and stylesheet order, not class
 * order, would decide the winner. Registering them keeps `cn()` honest.
 */
const FONT_SIZE_TOKENS = [
  'fs-10',
  'fs-105',
  'fs-11',
  'fs-115',
  'fs-12',
  'fs-125',
  'fs-13',
  'fs-14',
  'fs-15',
  'fs-16',
  'fs-18',
  'fs-21',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZE_TOKENS] }],
    },
  },
})

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

/** Extract a readable message from a message-bearing object or a plain string. */
function extractMessageString(value: unknown): string | null {
  if (value == null) return null

  if (typeof value === 'object') {
    return getMessageFromObject(value as Record<string, unknown>)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
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

/**
 * Turn a rejected binding call into user-readable text.
 *
 * Go errors arrive as a RuntimeError carrying the message verbatim, so the
 * common path is simply Error.message.
 */
export function formatErrorMessage(e: unknown): string {
  const fromObj = extractMessageString(e)
  if (fromObj) return fromObj

  if (e instanceof Error) return e.message.trim() || 'Operation failed'

  const s = String(e)
  if (s === '[object Object]') return 'Operation failed'
  return s
}
