/**
 * Desktop shell access for the UI.
 *
 * Window chrome is driven by the Wails window runtime directly; anything that
 * touches the filesystem, the network or the user's browser goes through a Go
 * service so the checks stay outside the renderer.
 */
import { Events, System, Window } from "@wailsio/runtime";
import { ShellService, SystemService, WindowService } from "@bindings/bridge";
import type { ShellPage } from "@bindings/bridge/models";
import type { Result as UpdateCheckResult } from "@bindings/update/models";

export type { UpdateCheckResult };

export const isMac = (): boolean => System.IsMac();

export type Platform = "mac" | "windows" | "linux";

/** The host the app is running on, for the labels and paths that differ by it. */
export const platform = (): Platform =>
  System.IsMac() ? "mac" : System.IsWindows() ? "windows" : "linux";

/**
 * Where the tray menu wants the shell to go.
 *
 * `connection` is a profile id as a string -- the key the shell tabs by -- and
 * empty means whichever tab is in front. `page` is a PageId, or "connections"
 * / "settings" for the views that sit beside the tabs. Keep both in step with
 * tray.NavigateRequest.
 */
export type TrayDestination = { connection: string; page: string };

/**
 * Subscribes to the system tray menu asking for a destination. Go raises the
 * window before emitting, so the listener only has to switch views. Keep the
 * name in step with tray.NavigateEvent.
 */
export function onTrayNavigate(listener: (to: TrayDestination) => void): () => void {
  return Events.On("tray:navigate", (event) => {
    // Go emits a single value, so data is the request itself, not a tuple.
    const data = event.data as Partial<TrayDestination> | undefined;
    if (typeof data?.page !== "string") return;
    listener({ connection: data.connection ?? "", page: data.page });
  });
}

/**
 * Tells Go which connection tab is in front, the page it is on, and the pages
 * that tab's sidebar offers.
 *
 * The tray menu draws all three. The page labels have to come from here rather
 * than be looked up in Go: the i18n bundles never reach the Go process, and
 * duplicating six protocols' navigation there is exactly what this avoids.
 */
export const reportShellSession = (
  active: string,
  page: string,
  pages: ShellPage[],
): Promise<void> => ShellService.ReportSession(active, page, pages);

/**
 * Subscribes to Go reporting that the settings changed. The tray writes them
 * too, so the window cannot assume it is the only author of its own copy.
 * Keep the name in step with bridge.SettingsEvent.
 */
export function onSettingsChanged(listener: () => void): () => void {
  return Events.On("settings:changed", () => listener());
}

export type ZoomCommand = "in" | "out" | "reset";

/**
 * Subscribes to the View menu's zoom entries. They drive the renderer's own UI
 * scale rather than the webview's page zoom; keep the name in step with
 * bridge.ZoomEvent.
 */
export function onZoomCommand(listener: (command: ZoomCommand) => void): () => void {
  return Events.On("ui:zoom", (event) => {
    const command: unknown = event.data;
    if (command === "in" || command === "out" || command === "reset") listener(command);
  });
}

/** Native window events exist on Windows and macOS only; Linux has none. */
const maximiseEvents = System.IsMac()
  ? (["mac:WindowMaximise", "mac:WindowUnMaximise"] as const)
  : (["windows:WindowMaximise", "windows:WindowUnMaximise"] as const);

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
    const [maximise, unmaximise] = maximiseEvents;
    const off = [
      Events.On(maximise, () => listener(true)),
      Events.On(unmaximise, () => listener(false)),
    ];
    return () => off.forEach((unsubscribe) => unsubscribe());
  },
  /** Syncs the native window background with the renderer light/dark theme. */
  setAppearance: (dark: boolean): Promise<void> =>
    WindowService.SetAppearance(dark),
};

/**
 * Re-centres the macOS traffic lights after the UI scale has changed the height
 * of the title bar they sit in. A no-op on the other platforms.
 */
export const setTitleBarHeight = (height: number): Promise<void> =>
  WindowService.SetTitleBarHeight(height);

export const appVersion = (): Promise<string> => SystemService.Version();
export const checkUpdate = (): Promise<UpdateCheckResult> =>
  SystemService.CheckUpdate();
export const openExternal = (url: string): Promise<void> =>
  SystemService.OpenExternal(url);

/** Where the app keeps its settings, connections and local key. */
export const dataDirectory = (): Promise<string> => SystemService.DataDirectory();
export const revealDataDirectory = (): Promise<void> =>
  SystemService.RevealDataDirectory();
