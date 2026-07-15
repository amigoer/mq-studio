import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * True only for a real electron-builder install.
 *
 * Temporary macOS .app bundles used for local icons/name also set
 * app.isPackaged=true, but they do not include app-update.yml or the
 * packaged update channel metadata.
 */
export function isReleaseInstall(): boolean {
  if (!app.isPackaged) return false
  return existsSync(join(process.resourcesPath, 'app-update.yml'))
}
