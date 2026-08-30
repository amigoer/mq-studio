import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isMac, onZoomCommand, setTitleBarHeight, type ZoomCommand } from "@/api/platform";
import { useSettings } from "@/hooks/useSettings";
import {
  autoFontSize,
  parseUIScale,
  scaleOf,
  stepFrom,
  type FontSize,
  type UIScaleSetting,
} from "@/lib/uiScale";

/*
 * Applies the UI scale to the document. `zoom` rather than a transform: it runs
 * layout, so a wider window shows more rows instead of the same layout blown up,
 * and the container queries in tokens.css see the room the chosen scale actually
 * leaves the shell.
 */

/** Keep in step with `.tb2` in frontend/src/design/tokens.css. */
const TITLE_BAR_HEIGHT = 40;

/*
 * The chosen scale lives in the settings file with everything else. This is a
 * mirror of it: the settings arrive from Go a tick after the window opens, and
 * the size the window opens at cannot wait for them.
 */
const CACHE_KEY = "mq-studio:ui-scale";

const ZOOM_KEYS: Readonly<Record<string, ZoomCommand>> = {
  "+": "in",
  "=": "in",
  "-": "out",
  _: "out",
  "0": "reset",
};

/*
 * On macOS the View menu claims ⌘=, ⌘- and ⌘0 and they arrive as the ZoomEvent
 * instead. Shift on the = key is the one press it cannot claim - see the
 * accelerator note in main.go - so it is all that is read from the keyboard
 * there. Both spellings: WebKit reports the character under Command as often
 * unshifted, so ⌘⇧= arrives as `=` with shiftKey rather than as `+`.
 */
const isMacZoomIn = (event: KeyboardEvent) =>
  event.shiftKey && (event.key === "+" || event.key === "=");

function readCache(): UIScaleSetting {
  try {
    return parseUIScale(localStorage.getItem(CACHE_KEY));
  } catch {
    return "auto";
  }
}

function writeCache(setting: UIScaleSetting): void {
  try {
    localStorage.setItem(CACHE_KEY, String(setting));
  } catch {
    // Storage may be unavailable; the next window then opens on the default
    // and corrects itself once the settings load.
  }
}

function apply(size: FontSize) {
  const scale = scaleOf(size);
  const root = document.documentElement;
  root.style.setProperty("zoom", String(scale));
  // Read by the few rules that must hold their on-screen size while the rest of
  // the shell scales around them; see `.tb2--mac`.
  root.style.setProperty("--mqs-scale", String(scale));
  // The macOS traffic lights are native: they keep their size and have to be
  // re-centred in a bar that no longer stands 40px tall. Off Wails there is no
  // native window to tell, and no title bar of ours to correct.
  setTitleBarHeight(TITLE_BAR_HEIGHT * scale).catch(() => {});
}

function viewport() {
  // `zoom` does not change the viewport, so this stays the window's own size and
  // the scale derived from it cannot feed back into itself.
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useUIScale() {
  const { settings, setSetting, loading } = useSettings();
  const [windowSize, setWindowSize] = useState(viewport);
  // Until the stored settings arrive, the cache is what bootstrapUIScale has
  // already put on screen; following it keeps the window from resizing itself
  // on the frame the settings land.
  const cached = useRef(readCache());
  const setting = loading ? cached.current : settings.uiScale;

  useEffect(() => {
    const onResize = () => setWindowSize(viewport);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const fontSize: FontSize =
    setting === "auto" ? autoFontSize(windowSize.width, windowSize.height) : setting;

  // Before paint: a scale written after it would show one frame of the old one.
  useLayoutEffect(() => {
    apply(fontSize);
  }, [fontSize]);

  const choose = useCallback(
    (next: UIScaleSetting) => {
      cached.current = next;
      setSetting("uiScale", next);
    },
    [setSetting],
  );

  // Mirrored on every change rather than only on a local one: a scale that
  // arrived with an imported config, or was migrated from an older settings
  // file, has to reach the cache too or the next window opens on the wrong one.
  useEffect(() => {
    if (loading) return;
    writeCache(settings.uiScale);
  }, [loading, settings.uiScale]);

  // The zoom commands step from whatever is showing, which the callback cannot
  // read from `setting` without being rebuilt - and rebuilt, it would resubscribe.
  const current = useRef(setting);
  current.current = setting;

  const zoom = useCallback(
    (command: ZoomCommand) => {
      if (command === "reset") {
        choose("auto");
        return;
      }
      const from =
        current.current === "auto"
          ? autoFontSize(window.innerWidth, window.innerHeight)
          : current.current;
      choose(stepFrom(from, command === "in" ? 1 : -1));
    },
    [choose],
  );

  useEffect(() => onZoomCommand(zoom), [zoom]);

  // The Windows and Linux windows are frameless and carry no menu to hold an
  // accelerator, so there every combination is read from the keyboard.
  useEffect(() => {
    const mac = isMac();
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const command = mac ? (isMacZoomIn(event) ? "in" : undefined) : ZOOM_KEYS[event.key];
      if (command === undefined) return;
      event.preventDefault();
      zoom(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  return { setting, fontSize, setSetting: choose };
}

/**
 * Applies the stored scale before React mounts, so the window does not open at
 * the drawn size and jump to the chosen one on the first frame.
 */
export function bootstrapUIScale() {
  if (typeof document === "undefined") return;
  const setting = readCache();
  apply(setting === "auto" ? autoFontSize(window.innerWidth, window.innerHeight) : setting);
}
