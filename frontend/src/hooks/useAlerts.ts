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
} from "react";
import { useTranslation } from "react-i18next";
import { EMPTY_OVERVIEW, useOverview } from "@/hooks/useOverview";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useSettings } from "@/hooks/useSettings";
import {
  type AlertRuleKey,
  type AlertRulePrefs,
  loadAlertRules,
  saveAlertRules,
} from "@/lib/alertRules";
import { dlqCount, groupName } from "@/mq/rocketmq/subscriptions";
import { brokerId, brokerName, commitLogDiskUsage } from "@/mq/rocketmq/nodes";

export type AlertSeverity = "crit" | "warn" | "info";

export interface AlertEntry {
  key: string;
  severity: AlertSeverity;
  ruleKey: AlertRuleKey;
  title: string;
  desc: string;
  since?: string;
}

interface AlertsContextValue {
  alerts: AlertEntry[];
  rules: AlertRulePrefs;
  toggleRule: (key: AlertRuleKey) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  hasOnline: boolean;
  lagThreshold: number;
  diskThreshold: number;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

function severityWeight(severity: AlertSeverity): number {
  return severity === "crit" ? 3 : severity === "warn" ? 2 : 1;
}

function useAlertsState(): AlertsContextValue {
  const { t } = useTranslation();
  const { data: snapshot, refresh, loading, online: hasOnline } = useOverview();
  const { key: scopeKey } = useConnectionScope();
  const { settings } = useSettings();
  const lagThreshold = settings.lagAlertThreshold ?? 10000;
  const diskThreshold = settings.diskAlertThreshold ?? 75;
  const data = snapshot ?? EMPTY_OVERVIEW;
  // The baseline resets per connection, so switching tabs does not announce
  // the new cluster's standing alerts as if they had just appeared.
  const connectionKey = hasOnline ? scopeKey : "offline";
  const [rules, setRules] = useState<AlertRulePrefs>(() => loadAlertRules());
  const knownAlertKeysRef = useRef<Set<string> | null>(null);
  const baselineConnectionRef = useRef(connectionKey);

  const toggleRule = useCallback((key: AlertRuleKey) => {
    setRules((previous) => {
      const next = { ...previous, [key]: !previous[key] };
      saveAlertRules(next);
      return next;
    });
  }, []);

  const alerts = useMemo<AlertEntry[]>(() => {
    if (!hasOnline) return [];
    const out: AlertEntry[] = [];
    if (rules.brokerOffline) {
      for (const broker of data.nodes) {
        if (broker.status === "offline") {
          out.push({
            key: `broker-off-${brokerName(broker)}-${brokerId(broker)}`,
            severity: "crit",
            ruleKey: "brokerOffline",
            title: t("alerts.rule.brokerOffline"),
            desc: `${brokerName(broker)}${brokerId(broker) !== 0 ? `-${brokerId(broker)}` : ""} (${broker.address || "—"})`,
            since: broker.lastSeen || undefined,
          });
        }
      }
    }
    for (const group of data.consumerGroups) {
      const lag = Number(group.backlog ?? 0);
      if (
        lagThreshold > 0 &&
        rules.groupOffline &&
        group.status === "offline" &&
        lag > lagThreshold &&
        (group.members ?? 0) === 0
      ) {
        out.push({
          key: `group-off-${groupName(group)}`,
          severity: "crit",
          ruleKey: "groupOffline",
          title: t("alerts.rule.groupOffline"),
          desc: `${groupName(group)} · lag ${lag.toLocaleString()}`,
          since: group.lastUpdated || undefined,
        });
      } else if (lagThreshold > 0 && rules.groupLag && lag > lagThreshold) {
        out.push({
          key: `group-lag-${groupName(group)}`,
          severity: "warn",
          ruleKey: "groupLag",
          title: t("alerts.rule.groupLag"),
          desc: `${groupName(group)} · lag ${lag.toLocaleString()} > ${lagThreshold.toLocaleString()}`,
          since: group.lastUpdated || undefined,
        });
      }
      if (rules.dlqGrowth && (dlqCount(group) ?? 0) > 0) {
        out.push({
          key: `dlq-${groupName(group)}`,
          severity: "info",
          ruleKey: "dlqGrowth",
          title: t("alerts.rule.dlqGrowth"),
          desc: `${groupName(group)} · ${dlqCount(group)} dead letters`,
        });
      }
    }
    if (rules.diskUsage && diskThreshold > 0) {
      for (const broker of data.nodes) {
        const usage = Number(commitLogDiskUsage(broker) ?? 0);
        if (usage >= diskThreshold) {
          out.push({
            key: `disk-${brokerName(broker)}-${brokerId(broker)}`,
            severity:
              usage >= Math.min(100, diskThreshold + 15) ? "crit" : "warn",
            ruleKey: "diskUsage",
            title: t("alerts.rule.diskUsage"),
            desc: `${brokerName(broker)}${brokerId(broker) !== 0 ? `-${brokerId(broker)}` : ""} · ${Math.round(usage)}% ≥ ${diskThreshold}%`,
            since: broker.lastSeen || undefined,
          });
        }
      }
    }
    return out.sort(
      (left, right) =>
        severityWeight(right.severity) - severityWeight(left.severity),
    );
  }, [data, diskThreshold, hasOnline, lagThreshold, rules, t]);

  // Provider lives outside page navigation, so alert polling and desktop notifications do not depend on the alerts page being open.
  useEffect(() => {
    const keys = new Set(alerts.map((alert) => alert.key));
    if (baselineConnectionRef.current !== connectionKey) {
      baselineConnectionRef.current = connectionKey;
      knownAlertKeysRef.current = keys;
      return;
    }
    const previous = knownAlertKeysRef.current;
    knownAlertKeysRef.current = keys;
    if (previous == null) return;
    if (!settings.desktopNotifications) return;
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    const fresh = alerts.filter((alert) => !previous.has(alert.key));
    const head = fresh[0];
    if (!head) return;
    const extra = fresh.length > 1 ? ` (+${fresh.length - 1})` : "";
    try {
      new Notification(`${head.title}${extra}`, {
        body: head.desc,
        tag: `mq-studio-alerts-${connectionKey}`,
      });
    } catch {
      // Some WebView environments reject constructing Notification.
    }
  }, [alerts, connectionKey, settings.desktopNotifications]);

  return {
    alerts,
    rules,
    toggleRule,
    refresh,
    loading,
    hasOnline,
    lagThreshold,
    diskThreshold,
  };
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  return createElement(
    AlertsContext.Provider,
    { value: useAlertsState() },
    children,
  );
}

export function useAlerts(): AlertsContextValue {
  const context = useContext(AlertsContext);
  if (!context) throw new Error("useAlerts must be used within AlertsProvider");
  return context;
}
