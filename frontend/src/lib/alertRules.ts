export type AlertRuleKey = 'brokerOffline' | 'groupOffline' | 'groupLag' | 'diskUsage' | 'dlqGrowth'

export type AlertRulePrefs = Record<AlertRuleKey, boolean>

const STORAGE_KEY = 'mq-studio:alert-rules'

export const DEFAULT_ALERT_RULES: AlertRulePrefs = {
  brokerOffline: true,
  groupOffline: true,
  groupLag: true,
  diskUsage: true,
  dlqGrowth: true,
}

export function loadAlertRules(): AlertRulePrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_ALERT_RULES }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_ALERT_RULES }
    const parsed = JSON.parse(raw) as Partial<AlertRulePrefs>
    return { ...DEFAULT_ALERT_RULES, ...parsed }
  } catch {
    return { ...DEFAULT_ALERT_RULES }
  }
}

export function saveAlertRules(rules: AlertRulePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  } catch {
    // ignore quota / private mode
  }
}
