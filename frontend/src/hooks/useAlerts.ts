import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useOverview } from '@/hooks/useOverview'
import { useSettings } from '@/hooks/useSettings'
import {
  type AlertRuleKey,
  type AlertRulePrefs,
  loadAlertRules,
  saveAlertRules,
} from '@/lib/alertRules'

export type AlertSeverity = 'crit' | 'warn' | 'info'

export interface AlertEntry {
  key: string
  severity: AlertSeverity
  ruleKey: AlertRuleKey
  title: string
  desc: string
  since?: string
}

interface AlertsContextValue {
  alerts: AlertEntry[]
  rules: AlertRulePrefs
  toggleRule: (key: AlertRuleKey) => void
  refresh: ReturnType<typeof useOverview>['refresh']
  loading: boolean
  hasOnline: boolean
  lagThreshold: number
  diskThreshold: number
}

const AlertsContext = createContext<AlertsContextValue | null>(null)

function severityWeight(severity: AlertSeverity): number {
  return severity === 'crit' ? 3 : severity === 'warn' ? 2 : 1
}

function useAlertsState(): AlertsContextValue {
  const { t } = useTranslation()
  const { data, refresh, loading } = useOverview()
  const { settings } = useSettings()
  const lagThreshold = settings.lagAlertThreshold ?? 10000
  const diskThreshold = settings.diskAlertThreshold ?? 75
  const hasOnline = data.activeConnection?.status === 'online'
  const connectionKey = hasOnline
    ? `${data.activeConnection?.id}:${data.activeConnection?.nameServer}`
    : 'offline'
  const [rules, setRules] = useState<AlertRulePrefs>(() => loadAlertRules())
  const knownAlertKeysRef = useRef<Set<string> | null>(null)
  const baselineConnectionRef = useRef(connectionKey)

  const toggleRule = useCallback((key: AlertRuleKey) => {
    setRules((previous) => {
      const next = { ...previous, [key]: !previous[key] }
      saveAlertRules(next)
      return next
    })
  }, [])

  const alerts = useMemo<AlertEntry[]>(() => {
    if (!hasOnline) return []
    const out: AlertEntry[] = []
    if (rules.brokerOffline) {
      for (const broker of data.brokers) {
        if (broker.status === 'offline') {
          out.push({
            key: `broker-off-${broker.brokerName}-${broker.brokerId}`,
            severity: 'crit',
            ruleKey: 'brokerOffline',
            title: t('alerts.rule.brokerOffline'),
            desc: `${broker.brokerName}${broker.brokerId !== 0 ? `-${broker.brokerId}` : ''} (${broker.address || '—'})`,
            since: broker.lastUpdate || undefined,
          })
        }
      }
    }
    for (const group of data.consumerGroups) {
      const lag = Number(group.lag ?? 0)
      if (
        lagThreshold > 0 &&
        rules.groupOffline &&
        group.status === 'offline' &&
        lag > lagThreshold &&
        (group.onlineClients ?? 0) === 0
      ) {
        out.push({
          key: `group-off-${group.group}`,
          severity: 'crit',
          ruleKey: 'groupOffline',
          title: t('alerts.rule.groupOffline'),
          desc: `${group.group} · lag ${lag.toLocaleString()}`,
          since: group.lastUpdate || undefined,
        })
      } else if (lagThreshold > 0 && rules.groupLag && lag > lagThreshold) {
        out.push({
          key: `group-lag-${group.group}`,
          severity: 'warn',
          ruleKey: 'groupLag',
          title: t('alerts.rule.groupLag'),
          desc: `${group.group} · lag ${lag.toLocaleString()} > ${lagThreshold.toLocaleString()}`,
          since: group.lastUpdate || undefined,
        })
      }
      if (rules.dlqGrowth && (group.dlq ?? 0) > 0) {
        out.push({
          key: `dlq-${group.group}`,
          severity: 'info',
          ruleKey: 'dlqGrowth',
          title: t('alerts.rule.dlqGrowth'),
          desc: `${group.group} · ${group.dlq} dead letters`,
        })
      }
    }
    if (rules.diskUsage && diskThreshold > 0) {
      for (const broker of data.brokers) {
        const usage = Number(broker.commitLogDiskUsage ?? 0)
        if (usage >= diskThreshold) {
          out.push({
            key: `disk-${broker.brokerName}-${broker.brokerId}`,
            severity: usage >= Math.min(100, diskThreshold + 15) ? 'crit' : 'warn',
            ruleKey: 'diskUsage',
            title: t('alerts.rule.diskUsage'),
            desc: `${broker.brokerName}${broker.brokerId !== 0 ? `-${broker.brokerId}` : ''} · ${Math.round(usage)}% ≥ ${diskThreshold}%`,
            since: broker.lastUpdate || undefined,
          })
        }
      }
    }
    return out.sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity))
  }, [data, diskThreshold, hasOnline, lagThreshold, rules, t])

  // Provider lives outside page navigation, so alert polling and desktop notifications do not depend on the alerts page being open.
  useEffect(() => {
    const keys = new Set(alerts.map((alert) => alert.key))
    if (baselineConnectionRef.current !== connectionKey) {
      baselineConnectionRef.current = connectionKey
      knownAlertKeysRef.current = keys
      return
    }
    const previous = knownAlertKeysRef.current
    knownAlertKeysRef.current = keys
    if (previous == null) return
    if (!settings.desktopNotifications) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const fresh = alerts.filter((alert) => !previous.has(alert.key))
    const head = fresh[0]
    if (!head) return
    const extra = fresh.length > 1 ? ` (+${fresh.length - 1})` : ''
    try {
      new Notification(`${head.title}${extra}`, {
        body: head.desc,
        tag: `rocket-leaf-alerts-${connectionKey}`,
      })
    } catch {
      // Some WebView environments reject constructing Notification.
    }
  }, [alerts, connectionKey, settings.desktopNotifications])

  return {
    alerts,
    rules,
    toggleRule,
    refresh,
    loading,
    hasOnline,
    lagThreshold,
    diskThreshold,
  }
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  return createElement(AlertsContext.Provider, { value: useAlertsState() }, children)
}

export function useAlerts(): AlertsContextValue {
  const context = useContext(AlertsContext)
  if (!context) throw new Error('useAlerts must be used within AlertsProvider')
  return context
}
