/**
 * RocketMQ endpoint parsing and validation.
 *
 * A name server list is one family's address format: hostname, IPv4 or IPv6
 * literal, optionally with a port, several of them separated by semicolons.
 * It moved out of the connection page because the page has to draw a form for
 * whatever family is selected, and only this module knows what a valid
 * RocketMQ address looks like.
 */
export const DEFAULT_NS_PORT = '9876'

export interface NsEntry {
  host: string
  port: string
}

/**
 * Keep only characters that can legally appear in a NameServer host —
 * hostname / IPv4 / IPv6 literal. Strips spaces, CJK, and other junk as
 * the user types so the field cannot hold an unparseable address.
 */
export function sanitizeHost(raw: string): string {
  return raw.replace(/[^0-9A-Za-z.:_\-[\]]/g, '')
}

export function isIPv4(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return m.slice(1, 5).every((o) => Number(o) <= 255)
}

export function isIPv6(s: string): boolean {
  const inner = s.replace(/^\[/, '').replace(/\]$/, '')
  if (!inner.includes(':')) return false
  if ((inner.match(/::/g) ?? []).length > 1) return false
  const groups = inner.split(':')
  const nonEmpty = groups.filter((g) => g !== '')
  if (nonEmpty.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return inner.includes('::') ? nonEmpty.length <= 7 : groups.length === 8
}

export function isHostname(s: string): boolean {
  if (s.length > 253) return false
  const host = s.endsWith('.') ? s.slice(0, -1) : s
  if (!host) return false
  return host
    .split('.')
    .every((label) => /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label))
}

/**
 * A NameServer host is valid when it is a real IPv4, an IPv6 literal, or a
 * hostname / domain. A string of only digits and dots must be a valid IPv4 —
 * this is what rejects near-misses like "192.168.2123" instead of accepting
 * them as an all-numeric hostname.
 */
export function isValidNsHost(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  if (s.startsWith('[') || s.includes(':')) return isIPv6(s)
  if (/^[\d.]+$/.test(s)) return isIPv4(s)
  return isHostname(s)
}

export function parseNameServers(raw: string): NsEntry[] {
  const parts = String(raw || '')
    .split(/[;\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return [{ host: '', port: DEFAULT_NS_PORT }]
  return parts.map((p) => {
    // [ipv6]:port
    if (p.startsWith('[')) {
      const m = p.match(/^\[([^\]]+)\](?::(\d+))?$/)
      if (m) return { host: m[1] ?? '', port: m[2] || DEFAULT_NS_PORT }
    }
    const lastColon = p.lastIndexOf(':')
    if (lastColon > 0 && /^\d+$/.test(p.slice(lastColon + 1))) {
      return { host: p.slice(0, lastColon), port: p.slice(lastColon + 1) }
    }
    return { host: p, port: DEFAULT_NS_PORT }
  })
}

export function joinNameServers(entries: NsEntry[]): string {
  return entries
    .map((e) => {
      const host = e.host.trim()
      if (!host) return ''
      const port = (e.port.trim() || DEFAULT_NS_PORT).replace(/\D/g, '') || DEFAULT_NS_PORT
      if (host.includes(':') && !host.startsWith('[')) {
        return `[${host}]:${port}`
      }
      return `${host}:${port}`
    })
    .filter(Boolean)
    .join(';')
}

/** Replaces one entry in the endpoint list, leaving the rest untouched. */
export function updateNsEntry(entries: NsEntry[], index: number, patch: Partial<NsEntry>): NsEntry[] {
  return entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
}
