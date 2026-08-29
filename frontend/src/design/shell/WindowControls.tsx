import { useCallback, useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { windowControls } from "@/api/platform";

/**
 * Window buttons for the frameless Windows and Linux window. macOS keeps its
 * native traffic lights, so `TitleBar` renders this only off darwin.
 *
 * Close only asks the window to close: Go's WindowClosing hook is what chooses
 * between hiding to the tray and quitting, so the renderer must not second
 * guess it with a confirmation of its own.
 *
 * The glyphs are smaller than the app's own icons: these act on the window, and
 * Windows draws its caption buttons at about 10px.
 */
const ICON = 13;

export function WindowControls() {
  const [maximised, setMaximised] = useState(false);

  const readMaximised = useCallback(() => {
    windowControls.isMaximised().then(setMaximised, () => setMaximised(false));
  }, []);

  useEffect(() => {
    readMaximised();
    return windowControls.onMaximisedChange(setMaximised);
  }, [readMaximised]);

  const restore = maximised ? "还原" : "最大化";

  return (
    <div className="wcg">
      <button
        type="button"
        className="wc"
        title="最小化"
        aria-label="最小化"
        onClick={() => void windowControls.minimise().catch(() => {})}
      >
        <Minus size={ICON} aria-hidden />
      </button>
      <button
        type="button"
        className="wc"
        title={restore}
        aria-label={restore}
        // Linux emits no maximise event, so the state is re-read either way.
        onClick={() => void windowControls.toggleMaximise().then(readMaximised, readMaximised)}
      >
        {maximised ? <Copy size={ICON - 1} aria-hidden /> : <Square size={ICON} aria-hidden />}
      </button>
      <button
        type="button"
        className="wc dgr"
        title="关闭"
        aria-label="关闭"
        onClick={() => void windowControls.close().catch(() => {})}
      >
        <X size={ICON} aria-hidden />
      </button>
    </div>
  );
}
