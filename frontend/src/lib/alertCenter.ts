/**
 * The notification centre's record keeping.
 *
 * `deriveAlerts` answers "what is wrong right now" for one connection. That is
 * not what a notification list shows: a list has to remember that something
 * started at 10:24, that you have already seen it, and that the one from 10:12
 * cleared on its own. This module is that memory, kept as a pure merge so the
 * fiddly part -- what counts as new, what counts as recovered, what a failed
 * poll must not conclude -- is testable without a broker.
 */
import type { AlertRuleKey } from "@/lib/alertRules";
import type { AlertSeverity, DerivedAlert } from "@/lib/alertDerive";

/** How long a recovered alert stays on the list before it is dropped. */
export const RESOLVED_RETENTION_MS = 30 * 60_000;

export interface AlertRecord {
  /** `${connectionId}:${ruleKey-and-subject}` -- unique across connections. */
  id: string;
  connectionId: number;
  ruleKey: AlertRuleKey;
  severity: AlertSeverity;
  params: Readonly<Record<string, string | number>>;
  /** What the broker said about the start, when it says anything. */
  since?: string;
  /** Epoch ms of the first poll that saw it, and of the most recent one. */
  firstSeen: number;
  lastSeen: number;
  /** Set once it stops firing. The row then reads as recovered. */
  resolvedAt?: number;
  read: boolean;
}

export function recordId(connectionId: number, key: string): string {
  return `${connectionId}:${key}`;
}

export interface MergeInput {
  previous: Readonly<Record<string, AlertRecord>>;
  /**
   * What each connection's state was found to be this round, by id. A
   * connection that is offline belongs here with an empty list; one whose poll
   * failed must be left out entirely -- a request that did not answer is not
   * evidence that the alert cleared.
   */
  observed: ReadonlyMap<number, readonly DerivedAlert[]>;
  /** Profiles that still exist. Records of anything else are forgotten. */
  known: ReadonlySet<number>;
  /** Ids the user has already seen, carried across restarts. */
  read: ReadonlySet<string>;
  now: number;
}

export interface MergeResult {
  records: Record<string, AlertRecord>;
  /** Newly firing and still unread: what a desktop notification announces. */
  fired: AlertRecord[];
}

export function mergeAlerts({
  previous,
  observed,
  known,
  read,
  now,
}: MergeInput): MergeResult {
  const records: Record<string, AlertRecord> = {};
  const fired: AlertRecord[] = [];

  // Carry forward, dropping deleted connections and expired recoveries.
  for (const record of Object.values(previous)) {
    if (!known.has(record.connectionId)) continue;
    if (record.resolvedAt != null && now - record.resolvedAt > RESOLVED_RETENTION_MS) {
      continue;
    }
    records[record.id] = record;
  }

  for (const [connectionId, alerts] of observed) {
    const stillFiring = new Set<string>();

    for (const derived of alerts) {
      const id = recordId(connectionId, derived.key);
      stillFiring.add(id);
      const before = records[id];
      const shape = {
        id,
        connectionId,
        ruleKey: derived.ruleKey,
        severity: derived.severity,
        params: derived.params,
        since: derived.since,
        lastSeen: now,
      };

      if (before != null && before.resolvedAt == null) {
        // Still firing: the numbers move, the record and its read state do not.
        records[id] = { ...before, ...shape };
        continue;
      }

      /*
       * Either brand new, or recovered and now back. A record that comes back
       * is unread again -- the user acknowledged the earlier episode, not this
       * one. A genuinely new record honours the stored read set instead, so a
       * standing alert does not re-announce itself on every launch.
       */
      const refired = before != null;
      const record: AlertRecord = {
        ...shape,
        firstSeen: now,
        read: refired ? false : read.has(id),
      };
      records[id] = record;
      if (!record.read) fired.push(record);
    }

    // Anything this connection was firing and no longer is has recovered.
    for (const record of Object.values(records)) {
      if (record.connectionId !== connectionId) continue;
      if (record.resolvedAt != null) continue;
      if (stillFiring.has(record.id)) continue;
      records[record.id] = { ...record, resolvedAt: now };
    }
  }

  return { records, fired };
}

/** Unread means still firing and not yet seen; a recovery announces nothing. */
export function unreadCount(records: Readonly<Record<string, AlertRecord>>): number {
  return Object.values(records).filter(
    (record) => !record.read && record.resolvedAt == null,
  ).length;
}

const READ_STORAGE_KEY = "mq-studio:alerts-read";
/** Enough to cover any plausible standing set; keeps the key from growing forever. */
const READ_MEMORY = 200;

export function loadReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveReadIds(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(
      READ_STORAGE_KEY,
      JSON.stringify([...ids].slice(-READ_MEMORY)),
    );
  } catch {
    // ignore quota / private mode
  }
}
