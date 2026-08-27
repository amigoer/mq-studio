export interface ConnectionPrefill {
  name?: string;
  host?: string;
  port?: string;
  /** Full NameServer string, e.g. host:port;host2:port */
  nameServer?: string;
}

const KEY = "mq-studio:connection-prefill";

export function setConnectionPrefill(prefill: ConnectionPrefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(prefill));
  } catch {
    // sessionStorage may be unavailable in some environments
  }
}

export function hasConnectionPrefill(): boolean {
  try {
    return sessionStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}

export function takeConnectionPrefill(): ConnectionPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as ConnectionPrefill;
  } catch {
    return null;
  }
}
