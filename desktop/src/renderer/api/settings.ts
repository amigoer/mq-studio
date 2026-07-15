import type { AppSettings } from '@generated/models'
import { callBackend } from './client'

export type { AppSettings }

export type GlobalCredentialsMode = 'preserve' | 'replace' | 'clear'

export const getSettings = (): Promise<AppSettings> => callBackend('settings.get')
export function updateSettings(
  settings: AppSettings,
  globalCredentialsMode: GlobalCredentialsMode = 'preserve',
): Promise<AppSettings> {
  return callBackend('settings.update', { ...settings, globalCredentialsMode })
}
export const resetSettings = (): Promise<AppSettings> => callBackend('settings.reset')
export const clearCache = (): Promise<void> => callBackend('settings.clearCache')

// 文件路径与明文配置只在 Electron 主进程中流转。
export const exportAllConfigToFile = (): Promise<string | null> =>
  window.rocketLeaf.dialogs.exportConfig()
export const importAllConfigFromFile = (): Promise<string | null> =>
  window.rocketLeaf.dialogs.importConfig()
