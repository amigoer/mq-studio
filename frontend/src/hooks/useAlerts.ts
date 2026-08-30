/**
 * The alerts of the one connection a page is scoped to.
 *
 * A view over `useAlertCenter`, not a second store: the centre already polls
 * every open connection and keeps the records, and a page that derived its own
 * would answer differently from the bell above it the moment a threshold moved.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAlertCenter } from "@/hooks/useAlertCenter";
import { useAlertRules } from "@/hooks/useAlertRules";
import { useSettings } from "@/hooks/useSettings";
import { useConnectionScope } from "@/mq/ConnectionScope";
import type { AlertRuleKey, AlertRulePrefs } from "@/lib/alertRules";
import type { AlertSeverity } from "@/lib/alertDerive";
import { alertBody, alertTitle } from "@/lib/alertText";

export type { AlertSeverity };

export interface AlertEntry {
  key: string;
  severity: AlertSeverity;
  ruleKey: AlertRuleKey;
  title: string;
  desc: string;
  since?: string;
}

interface AlertsValue {
  /** Firing now, worst first. Recovered records belong to the bell, not here. */
  alerts: AlertEntry[];
  rules: AlertRulePrefs;
  toggleRule: (key: AlertRuleKey) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  hasOnline: boolean;
  lagThreshold: number;
  diskThreshold: number;
}

const SEVERITY_WEIGHT: Record<AlertSeverity, number> = { crit: 3, warn: 2, info: 1 };

export function useAlerts(): AlertsValue {
  const { t } = useTranslation();
  const { groups, loading, refresh } = useAlertCenter();
  const { rules, toggleRule } = useAlertRules();
  const { settings } = useSettings();
  const { id: connectionId, online } = useConnectionScope();

  const alerts = useMemo<AlertEntry[]>(() => {
    const group = groups.find((candidate) => candidate.connectionId === connectionId);
    if (group == null || !online) return [];
    return group.records
      .filter((record) => record.resolvedAt == null)
      .map((record) => ({
        key: record.id,
        severity: record.severity,
        ruleKey: record.ruleKey,
        title: alertTitle(t, record),
        desc: alertBody(t, record),
        since: record.since,
      }))
      .sort(
        (left, right) =>
          SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity],
      );
  }, [groups, connectionId, online, t]);

  return {
    alerts,
    rules,
    toggleRule,
    refresh,
    loading,
    hasOnline: online,
    lagThreshold: settings.lagAlertThreshold ?? 10000,
    diskThreshold: settings.diskAlertThreshold ?? 75,
  };
}
