/*
 * The 界面过渡动画 switch, on the JavaScript side.
 *
 * The CSS half lives in tokens.css: every duration in the shell is a `--mo-*`
 * variable, and the switch collapses them to 0s, so motion is dropped rather
 * than shortened and a transition can never be caught mid-way.
 *
 * What CSS cannot do on its own is keep a closing overlay mounted long enough
 * to animate out. `usePresence` holds it, and has to read the switch too --
 * otherwise turning motion off would leave every dismissed dialog sitting on
 * screen for the length of an exit that is no longer being drawn.
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

/** Milliseconds, matching `--mo-fast` / `--mo-base` / `--mo-slow`. */
export const DURATION = {
  fast: 120,
  base: 180,
  slow: 260,
} as const;

/** Written by useUIPrefs; read here rather than subscribed to, since every
 *  caller reads it inside an effect that the toggle itself re-runs. */
export function motionEnabled(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-animations") !== "off";
}

export type PresenceState = "open" | "closed";

/**
 * Mount/unmount around an enter and an exit animation. `mounted` is what the
 * caller renders on; `state` goes on the element as `data-state`, which the
 * `.mqs-*` rules in tokens.css animate between.
 */
export function usePresence(
  open: boolean,
  duration: number = DURATION.base,
): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<PresenceState>(open ? "open" : "closed");

  useEffect(() => {
    if (open) {
      setMounted(true);
      return afterFirstPaint(() => setState("open"));
    }
    setState("closed");
    if (!motionEnabled()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), duration);
    return () => window.clearTimeout(timer);
  }, [duration, open]);

  return { mounted, state };
}

/**
 * The enter half of usePresence, for an overlay its caller mounts and unmounts
 * directly instead of holding an `open` flag -- the detail sheets, which every
 * board renders behind its own `selected &&`. There is no exit to hold for, so
 * this is only the closed first frame the transition needs to start from.
 */
export function useEnter(): PresenceState {
  const [state, setState] = useState<PresenceState>("closed");
  useEffect(() => afterFirstPaint(() => setState("open")), []);
  return state;
}
