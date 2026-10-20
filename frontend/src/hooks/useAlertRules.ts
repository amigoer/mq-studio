import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { DEFAULT_ALERT_RULES, type AlertRuleKey, type AlertRulePrefs } from "@/lib/alertRules";

export const ALERT_RULES_STORAGE_KEY = "mq-studio:alert-rules";

/*
 * The key holds the bare toggles, as it did before this store: persist's own
 * envelope ({ state, version }) would leave every earlier save unreadable.
 */
const storage: PersistStorage<Partial<AlertRulePrefs>> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      return raw == null ? null : { state: JSON.parse(raw) as Partial<AlertRulePrefs> };
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, JSON.stringify(value.state));
    } catch {
      // Quota or private mode: the toggles hold for this session only.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // As above.
    }
  },
};

/**
 * The rule toggles, shared by every reader in the window.
 *
 * The alerts page owns the switches and the notification centre counts what
 * they leave enabled, so the two have to see one value: turning a rule off on
 * the page must empty the bell in the same tick, not at the centre's next poll.
 */
export const useAlertRules = create<{
  rules: AlertRulePrefs;
  toggleRule: (key: AlertRuleKey) => void;
}>()(
  persist(
    (set) => ({
      rules: { ...DEFAULT_ALERT_RULES },
      toggleRule: (key) => set(({ rules }) => ({ rules: { ...rules, [key]: !rules[key] } })),
    }),
    {
      name: ALERT_RULES_STORAGE_KEY,
      storage,
      partialize: (state) => state.rules,
      // A rule added since the last save starts at its default.
      merge: (saved, current) => ({
        ...current,
        rules: { ...DEFAULT_ALERT_RULES, ...(saved as Partial<AlertRulePrefs> | undefined) },
      }),
    },
  ),
);
