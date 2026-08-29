import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { isMac, onZoomCommand, setTitleBarHeight, type ZoomCommand } from "@/api/platform";
import {
  autoFontSize,
  FONT_SIZES,
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

const STORAGE_KEY = "mq-studio:ui-scale";

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

function loadSetting(): UIScaleSetting {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === "auto") return "auto";
    const size = Number(raw);
    return (FONT_SIZES as readonly number[]).includes(size) ? (size as FontSize) : "auto";
  } catch {
    return "auto";
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
  const [setting, setSetting] = useState<UIScaleSetting>(loadSetting);
  const [windowSize, setWindowSize] = useState(viewport);

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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(setting));
    } catch {
      // Storage may be unavailable; the choice then lasts the session only.
    }
  }, [setting]);

  const zoom = useCallback((command: ZoomCommand) => {
    if (command === "reset") {
      setSetting("auto");
      return;
    }
    setSetting((current) => {
      const from =
        current === "auto" ? autoFontSize(window.innerWidth, window.innerHeight) : current;
      return stepFrom(from, command === "in" ? 1 : -1);
    });
  }, []);

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

  return { setting, fontSize, setSetting };
}

/**
 * Applies the stored scale before React mounts, so the window does not open at
 * the drawn size and jump to the chosen one on the first frame.
 */
export function bootstrapUIScale() {
  if (typeof document === "undefined") return;
  const setting = loadSetting();
  apply(setting === "auto" ? autoFontSize(window.innerWidth, window.innerHeight) : setting);
}
