import { useCallback, useSyncExternalStore } from "react";
import {
  getAlertRules,
  saveAlertRules,
  subscribeAlertRules,
  type AlertRuleKey,
  type AlertRulePrefs,
} from "@/lib/alertRules";

/**
 * The rule toggles, shared by every reader in the window.
 *
 * The alerts page owns the switches and the notification centre counts what
 * they leave enabled, so the two have to see one value: turning a rule off on
 * the page must empty the bell in the same tick, not at the centre's next poll.
 */
export function useAlertRules(): {
  rules: AlertRulePrefs;
  toggleRule: (key: AlertRuleKey) => void;
} {
  const rules = useSyncExternalStore(subscribeAlertRules, getAlertRules, getAlertRules);
  const toggleRule = useCallback((key: AlertRuleKey) => {
    const current = getAlertRules();
    saveAlertRules({ ...current, [key]: !current[key] });
  }, []);
  return { rules, toggleRule };
}
