import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getSettings,
  updateSettings,
  resetSettings as apiResetSettings,
} from "@/api/settings";
import type { AppSettings } from "@/api/settings";
import { onSettingsChanged, windowControls } from "@/api/platform";
import { isPolicy, Policy } from "@/api/updates";
import { setLanguage as setI18nLanguage, type SupportedLanguage } from "@/i18n";
import { monoFontStack, uiFontStack } from "@/lib/fonts";
import { applyTheme, cacheTheme, resolveDark, type ThemeMode } from "@/lib/theme";
import { parseUIScale, type UIScaleSetting } from "@/lib/uiScale";

export type { ThemeMode };
export type Language = "en" | "zh";
export type Timezone = "local" | "utc";
export type TimestampFormat = "datetime" | "ms";
export type FetchLimit = 32 | 64 | 128;
export type CloseBehavior = "minimizeToTray" | "quit";

// Frontend settings shape (aligned with backend AppSettings fields)
export interface FrontendSettings {
  theme: ThemeMode;
  language: Language;
  /** "auto" or a step on the interface size ladder; see lib/uiScale. */
  uiScale: UIScaleSetting;
  uiFont: string;
  monospaceFont: string;
  autoConnectLast: boolean;
  /** How far updates go on their own; see api/updates. */
  updatePolicy: Policy;
  closeBehavior: CloseBehavior;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  globalAccessKey: string;
  globalSecretKey: string;
  globalAccessKeyConfigured: boolean;
  globalSecretKeyConfigured: boolean;
  timezone: Timezone;
  timestampFormat: TimestampFormat;
  autoFormatJson: boolean;
  lagAlertThreshold: number;
  diskAlertThreshold: number;
  desktopNotifications: boolean;
  maxPayloadRenderBytes: number;
  fetchLimit: FetchLimit;
}

const DEFAULTS: FrontendSettings = {
  theme: "system",
  language: "zh",
  uiScale: "auto",
  uiFont: "system",
  monospaceFont: "JetBrains Mono",
  autoConnectLast: true,
  updatePolicy: Policy.PolicyNotify,
  closeBehavior: "minimizeToTray",
  connectTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  globalAccessKey: "",
  globalSecretKey: "",
  globalAccessKeyConfigured: false,
  globalSecretKeyConfigured: false,
  lagAlertThreshold: 10000,
  diskAlertThreshold: 75,
  desktopNotifications: false,
  timezone: "local",
  timestampFormat: "datetime",
  autoFormatJson: true,
  maxPayloadRenderBytes: 512 * 1024,
  fetchLimit: 64,
};

// Map backend AppSettings to the frontend type
function toFrontend(s: AppSettings): FrontendSettings {
  return {
    theme: (["system", "light", "dark"].includes(s.theme)
      ? s.theme
      : DEFAULTS.theme) as ThemeMode,
    language: (s.language as Language) || DEFAULTS.language,
    uiScale: parseUIScale(s.uiScale),
    uiFont: s.uiFont || DEFAULTS.uiFont,
    monospaceFont: s.monospaceFont || DEFAULTS.monospaceFont,
    autoConnectLast: s.autoConnectLast ?? DEFAULTS.autoConnectLast,
    updatePolicy: isPolicy(s.updatePolicy) ? s.updatePolicy : DEFAULTS.updatePolicy,
    closeBehavior: (s.closeBehavior as CloseBehavior) || DEFAULTS.closeBehavior,
    connectTimeoutMs: s.connectTimeoutMs || DEFAULTS.connectTimeoutMs,
    requestTimeoutMs: s.requestTimeoutMs || DEFAULTS.requestTimeoutMs,
    globalAccessKey: s.globalAccessKey ?? "",
    globalSecretKey: s.globalSecretKey ?? "",
    globalAccessKeyConfigured: s.globalAccessKeyConfigured ?? false,
    globalSecretKeyConfigured: s.globalSecretKeyConfigured ?? false,
    lagAlertThreshold:
      typeof s.lagAlertThreshold === "number"
        ? s.lagAlertThreshold
        : DEFAULTS.lagAlertThreshold,
    diskAlertThreshold:
      typeof s.diskAlertThreshold === "number"
        ? s.diskAlertThreshold
        : DEFAULTS.diskAlertThreshold,
    desktopNotifications:
      s.desktopNotifications ?? DEFAULTS.desktopNotifications,
    timezone: (s.timezone as Timezone) || DEFAULTS.timezone,
    timestampFormat:
      (s.timestampFormat as TimestampFormat) || DEFAULTS.timestampFormat,
    autoFormatJson: s.autoFormatJson ?? DEFAULTS.autoFormatJson,
    maxPayloadRenderBytes:
      s.maxPayloadRenderBytes || DEFAULTS.maxPayloadRenderBytes,
    fetchLimit: (s.fetchLimit as FetchLimit) || DEFAULTS.fetchLimit,
  };
}

// Map frontend settings to backend AppSettings (plain object)
function toBackend(s: FrontendSettings): AppSettings {
  const {
    globalAccessKeyConfigured: _accessConfigured,
    globalSecretKeyConfigured: _secretConfigured,
    uiScale,
    ...settings
  } = s;
  return { ...settings, uiScale: String(uiScale) } as unknown as AppSettings;
}

type SettingsContextValue = {
  settings: FrontendSettings;
  setSetting: <K extends keyof FrontendSettings>(
    key: K,
    value: FrontendSettings[K],
  ) => void;
  resetAllSettings: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  settlePendingSaves: () => Promise<void>;
  saveGlobalCredentials: (
    accessKey: string,
    secretKey: string,
  ) => Promise<void>;
  clearGlobalCredentials: () => Promise<void>;
  loading: boolean;
  effectiveDark: boolean;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Writes everything the document itself carries, and reports the theme that
 * was applied. The interface size is not among them: useUIScale zooms the
 * whole document rather than setting a size here.
 */
function applySettingsToDocument(settings: FrontendSettings): boolean {
  const root = document.documentElement;

  // Theme
  const dark = applyTheme(settings.theme);
  cacheTheme(settings.theme);

  // Fonts
  root.style.setProperty("--app-ui-font", uiFontStack(settings.uiFont));
  root.style.setProperty("--app-monospace-font", monoFontStack(settings.monospaceFont));

  // Language
  root.lang = settings.language === "en" ? "en" : "zh-CN";
  setI18nLanguage(settings.language as SupportedLanguage);

  return dark;
}

function useSettingsStore(): SettingsContextValue {
  const [settings, setSettingsState] = useState<FrontendSettings>(DEFAULTS);
  const settingsRef = useRef<FrontendSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [effectiveDark, setEffectiveDark] = useState(() =>
    resolveDark(DEFAULTS.theme),
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<FrontendSettings | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const savesInFlightRef = useRef(0);

  // Load settings from backend on mount
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((result) => {
        if (!cancelled && result) {
          setSettingsState(toFrontend(result));
        }
      })
      .catch(() => {
        // Fall back to defaults when backend is unavailable
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    const dark = applySettingsToDocument(settings);
    setEffectiveDark(dark);
    // Keep the native window chrome in step: it is what shows through as a
    // hairline under the macOS traffic lights.
    void windowControls.setAppearance(dark).catch(() => {});
  }, [settings]);

  // Listen for system theme changes (only when theme === 'system')
  useEffect(() => {
    if (settings.theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const dark = applyTheme("system");
      setEffectiveDark(dark);
      void windowControls.setAppearance(dark).catch(() => {});
    };
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, [settings.theme]);

  const enqueueSave = useCallback((next: FrontendSettings) => {
    // Serialize all writes so an earlier request cannot finish later and overwrite newer settings.
    savesInFlightRef.current += 1;
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await updateSettings(toBackend(next), "preserve");
      })
      .finally(() => {
        savesInFlightRef.current -= 1;
      });
    saveChainRef.current = operation;
    void operation.catch((err) =>
      console.error("Failed to save settings:", err),
    );
    return operation;
  }, []);

  // Debounced save to backend
  const saveToBackend = useCallback(
    (newSettings: FrontendSettings) => {
      pendingSettingsRef.current = newSettings;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const pending = pendingSettingsRef.current;
        pendingSettingsRef.current = null;
        if (pending) void enqueueSave(pending);
      }, 300);
    },
    [enqueueSave],
  );

  const settlePendingSaves = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSettingsRef.current;
    pendingSettingsRef.current = null;
    if (pending) enqueueSave(pending);
    await saveChainRef.current;
  }, [enqueueSave]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const setSetting = useCallback(
    <K extends keyof FrontendSettings>(key: K, value: FrontendSettings[K]) => {
      setSettingsState((prev) => {
        const next = { ...prev, [key]: value };
        saveToBackend(next);
        return next;
      });
    },
    [saveToBackend],
  );

  const resetAllSettings = useCallback(async () => {
    try {
      // Ensure reset is the last write so a pending 300ms debounced save cannot restore old settings.
      await settlePendingSaves();
      const result = await apiResetSettings();
      if (result) {
        setSettingsState(toFrontend(result));
      }
    } catch (err) {
      console.error("Failed to reset settings:", err);
      throw err;
    }
  }, [settlePendingSaves]);

  const reloadSettings = useCallback(async () => {
    const result = await getSettings();
    if (result) setSettingsState(toFrontend(result));
  }, []);

  /*
   * The tray writes settings too, so what Go holds can move without this
   * provider doing anything. Our own saves come back the same way, and
   * re-reading over a change the user has made since would undo it, so a
   * pending or in-flight save skips the reload - the save carries the value
   * either way.
   */
  useEffect(
    () =>
      onSettingsChanged(() => {
        if (saveTimerRef.current != null || savesInFlightRef.current > 0) return;
        void reloadSettings().catch(() => {});
      }),
    [reloadSettings],
  );

  const saveGlobalCredentials = useCallback(
    async (accessKey: string, secretKey: string) => {
      const trimmedAccessKey = accessKey.trim();
      if (!trimmedAccessKey || !secretKey.trim()) {
        throw new Error("AccessKey and SecretKey must both be provided");
      }
      await settlePendingSaves();
      const next = {
        ...settingsRef.current,
        globalAccessKey: trimmedAccessKey,
        globalSecretKey: secretKey,
      };
      const operation = saveChainRef.current
        .catch(() => undefined)
        .then(() => updateSettings(toBackend(next), "replace"));
      saveChainRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      const result = await operation;
      setSettingsState(toFrontend(result));
    },
    [settlePendingSaves],
  );

  const clearGlobalCredentials = useCallback(async () => {
    await settlePendingSaves();
    const next = {
      ...settingsRef.current,
      globalAccessKey: "",
      globalSecretKey: "",
    };
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(() => updateSettings(toBackend(next), "clear"));
    saveChainRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    const result = await operation;
    setSettingsState(toFrontend(result));
  }, [settlePendingSaves]);

  return {
    settings,
    setSetting,
    resetAllSettings,
    reloadSettings,
    settlePendingSaves,
    saveGlobalCredentials,
    clearGlobalCredentials,
    loading,
    effectiveDark,
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettingsStore();
  return createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context == null) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
