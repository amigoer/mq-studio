/**
 * Desktop shell access for the UI.
 *
 * Window chrome is driven by the Wails window runtime directly; anything that
 * touches the filesystem, the network or the user's browser goes through a Go
 * service so the checks stay outside the renderer.
 */
import { Events, System, Window } from '@wailsio/runtime'
import { SystemService, WindowService } from '@bindings/bridge'
import type { Result as UpdateCheckResult } from '@bindings/update/models'

export type { UpdateCheckResult }

export const isMac = (): boolean => System.IsMac()

/**
 * Subscribes to the system tray menu asking for a page. The payload is a
 * sidebar NavId; Go raises the window before emitting, so the listener only
 * has to switch pages. Keep the name in step with tray.NavigateEvent.
 */
export function onTrayNavigate(listener: (target: string) => void): () => void {
  return Events.On('tray:navigate', (event) => {
    // Go emits a single value, so data is the NavId itself, not a tuple.
    const target: unknown = event.data
    if (typeof target === 'string') listener(target)
  })
}

/** Native window events exist on Windows and macOS only; Linux has none. */
const maximiseEvents = System.IsMac()
  ? (['mac:WindowMaximise', 'mac:WindowUnMaximise'] as const)
  : (['windows:WindowMaximise', 'windows:WindowUnMaximise'] as const)

export const windowControls = {
  minimise: (): Promise<void> => Window.Minimise(),
  toggleMaximise: (): Promise<void> => Window.ToggleMaximise(),
  close: (): Promise<void> => Window.Close(),
  isMaximised: (): Promise<boolean> => Window.IsMaximised(),
  /**
   * Subscribes to native maximise changes. On Linux no such event is emitted,
   * so callers must still re-read isMaximised after toggling.
   */
  onMaximisedChange(listener: (maximised: boolean) => void): () => void {
    const [maximise, unmaximise] = maximiseEvents
    const off = [
      Events.On(maximise, () => listener(true)),
      Events.On(unmaximise, () => listener(false)),
    ]
    return () => off.forEach((unsubscribe) => unsubscribe())
  },
  /** Syncs the native window background with the renderer light/dark theme. */
  setAppearance: (dark: boolean): Promise<void> => WindowService.SetAppearance(dark),
}

export const appVersion = (): Promise<string> => SystemService.Version()
export const checkUpdate = (): Promise<UpdateCheckResult> => SystemService.CheckUpdate()
export const openExternal = (url: string): Promise<void> => SystemService.OpenExternal(url)
