import { SettingsService, SystemService } from "@bindings/bridge";
import type { AppSettings } from "./models";
import { required } from "./client";

export type { AppSettings };

export type GlobalCredentialsMode = "preserve" | "replace" | "clear";

export const getSettings = (): Promise<AppSettings> =>
  SettingsService.Get().then(required);
export function updateSettings(
  settings: AppSettings,
  globalCredentialsMode: GlobalCredentialsMode = "preserve",
): Promise<AppSettings> {
  return SettingsService.Update({ ...settings, globalCredentialsMode }).then(
    required,
  );
}
export const resetSettings = (): Promise<AppSettings> =>
  SettingsService.Reset().then(required);
export const clearCache = (): Promise<void> => SettingsService.ClearCache();

// File paths and plaintext config never reach the renderer: Go owns the dialog,
// reads and writes the file, and hands back only the chosen path.
export const exportAllConfigToFile = (): Promise<string | null> =>
  SystemService.ExportConfig().then((path) => path || null);
export const importAllConfigFromFile = (): Promise<string | null> =>
  SystemService.ImportConfig().then((path) => path || null);
