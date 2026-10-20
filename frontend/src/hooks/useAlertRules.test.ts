import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_RULES } from "@/lib/alertRules";

const store = new Map<string, string>();
let useAlertRules: typeof import("./useAlertRules").useAlertRules;
let KEY: string;

beforeAll(async () => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  // Imported after the stub: the store reads storage as it is created.
  ({ useAlertRules, ALERT_RULES_STORAGE_KEY: KEY } = await import("./useAlertRules"));
});

beforeEach(() => {
  store.clear();
  useAlertRules.setState({ rules: { ...DEFAULT_ALERT_RULES } });
  store.clear();
});

describe("alert rule storage", () => {
  it("returns defaults when empty", async () => {
    await useAlertRules.persist.rehydrate();
    expect(useAlertRules.getState().rules).toEqual(DEFAULT_ALERT_RULES);
  });

  it("persists and reloads toggles", async () => {
    useAlertRules.getState().toggleRule("groupLag");
    useAlertRules.getState().toggleRule("dlqGrowth");

    // A fresh module is a fresh window: nothing carried over but storage.
    vi.resetModules();
    const fresh = (await import("./useAlertRules")).useAlertRules;
    const { rules } = fresh.getState();
    expect(rules.groupLag).toBe(false);
    expect(rules.dlqGrowth).toBe(false);
    expect(rules.brokerOffline).toBe(true);
  });

  it("keeps the bare toggles earlier versions wrote", async () => {
    useAlertRules.getState().toggleRule("groupLag");
    const saved = JSON.parse(store.get(KEY) ?? "null") as Record<string, unknown>;
    expect(saved.groupLag).toBe(false);
    expect(saved).not.toHaveProperty("state");
  });

  it("merges partial stored prefs with defaults", async () => {
    store.set(KEY, JSON.stringify({ groupLag: false }));
    await useAlertRules.persist.rehydrate();
    const { rules } = useAlertRules.getState();
    expect(rules.groupLag).toBe(false);
    expect(rules.brokerOffline).toBe(true);
  });
});
