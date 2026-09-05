/*
 * The 界面过渡动画 switch, on the JavaScript side.
 *
 * The CSS half lives in tokens.css: every duration in the shell is a `--mo-*`
 * variable, and the switch collapses them to 0s, so motion is dropped rather
 * than shortened and a transition can never be caught mid-way.
 *
 * What CSS cannot do on its own is give an element that has just mounted a
 * closed frame to animate out of. That is all this is now. It used to hold a
 * closing overlay mounted for its exit as well, for a scrim, a modal and a
 * menu that tokens.css no longer draws: shadcn's overlays arrived with their
 * own presence, and Radix holds a panel for its exit itself.
 */

import { useEffect, useState } from "react";

/**
 * The opening element renders one frame closed so the transition has a start
 * value; assigning both in the same frame would show only the end.
 *
 * A frame is what marks that first paint, but a window that is not being
 * painted -- minimised, or behind another space -- never gets one, and the
 * overlay would then sit at opacity 0 for as long as the window stayed hidden.
 * The timer is the backstop: in a window on screen the frame always wins, and
 * in one that is not there is no animation to lose.
 */
function afterFirstPaint(run: () => void): () => void {
  const frame = requestAnimationFrame(run);
  const timer = window.setTimeout(run, 60);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

export type PresenceState = "open" | "closed";

/**
 * The closed first frame an entering overlay needs to start from, for one its
 * caller mounts and unmounts directly instead of holding an `open` flag -- the
 * detail sheets, which every board renders behind its own `selected &&`. There
 * is no exit to hold for. Goes on the element as `data-state`, which the
 * `.mqs-slide-right` rule in tokens.css animates between.
 */
export function useEnter(): PresenceState {
  const [state, setState] = useState<PresenceState>("closed");
  useEffect(() => afterFirstPaint(() => setState("open")), []);
  return state;
}
