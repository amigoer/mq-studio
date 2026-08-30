import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ALERT_RULES,
  loadAlertRules,
  saveAlertRules,
  type AlertRulePrefs,
} from "./alertRules";

const KEY = "mq-studio:alert-rules";

describe("alertRules storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns defaults when empty", () => {
    const rules = loadAlertRules();
    expect(rules).toEqual(DEFAULT_ALERT_RULES);
  });

  it("persists and reloads toggles", () => {
    const next: AlertRulePrefs = {
      ...DEFAULT_ALERT_RULES,
      groupLag: false,
      dlqGrowth: false,
    };
    saveAlertRules(next);
    expect(loadAlertRules().groupLag).toBe(false);
    expect(loadAlertRules().dlqGrowth).toBe(false);
    expect(loadAlertRules().brokerOffline).toBe(true);
    expect(store.get(KEY)).toBeTruthy();
  });

  it("merges partial stored prefs with defaults", () => {
    store.set(KEY, JSON.stringify({ groupLag: false }));
    const rules = loadAlertRules();
    expect(rules.groupLag).toBe(false);
    expect(rules.brokerOffline).toBe(true);
  });
});
