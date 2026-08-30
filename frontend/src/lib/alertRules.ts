export type AlertRuleKey =
  "brokerOffline" | "groupOffline" | "groupLag" | "diskUsage" | "dlqGrowth";

export type AlertRulePrefs = Record<AlertRuleKey, boolean>;

/** Every rule, in the order a list of them reads best: worst first. */
export const ALERT_RULE_KEYS: readonly AlertRuleKey[] = [
  "brokerOffline",
  "groupOffline",
  "groupLag",
  "diskUsage",
  "dlqGrowth",
];

const STORAGE_KEY = "mq-studio:alert-rules";

export const DEFAULT_ALERT_RULES: AlertRulePrefs = {
  brokerOffline: true,
  groupOffline: true,
  groupLag: true,
  diskUsage: true,
  dlqGrowth: true,
};

function read(): AlertRulePrefs {
  if (typeof window === "undefined") return { ...DEFAULT_ALERT_RULES };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ALERT_RULES };
    const parsed = JSON.parse(raw) as Partial<AlertRulePrefs>;
    return { ...DEFAULT_ALERT_RULES, ...parsed };
  } catch {
    return { ...DEFAULT_ALERT_RULES };
  }
}

/*
 * One snapshot for the whole window.
 *
 * The alerts page and the notification centre both read these, and a toggle on
 * the page has to reach the centre in the same tick -- two hooks each holding
 * their own useState copy would leave the bell counting rows the page had just
 * switched off. The identity is stable until a write, which is what
 * useSyncExternalStore needs to avoid an infinite re-render.
 */
let current: AlertRulePrefs = read();
const listeners = new Set<() => void>();

export function getAlertRules(): AlertRulePrefs {
  return current;
}

export function subscribeAlertRules(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function same(left: AlertRulePrefs, right: AlertRulePrefs): boolean {
  return (Object.keys(DEFAULT_ALERT_RULES) as AlertRuleKey[]).every(
    (key) => left[key] === right[key],
  );
}

/**
 * Re-reads storage, keeping the cached identity when nothing changed.
 *
 * Something outside this module may have written the key -- another window, or
 * a restore -- so this is a real read; holding the identity when the content
 * matches is what keeps `getAlertRules` usable as a store snapshot.
 */
export function loadAlertRules(): AlertRulePrefs {
  const fresh = read();
  if (!same(fresh, current)) current = fresh;
  return current;
}

export function saveAlertRules(rules: AlertRulePrefs): void {
  current = rules;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // ignore quota / private mode
  }
  for (const listener of listeners) listener();
}
