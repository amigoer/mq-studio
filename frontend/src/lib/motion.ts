/*
 * The 界面过渡动画 switch, on the JavaScript side.
 *
 * The CSS half lives in tokens.css: every duration in the shell is a `--mo-*`
 * variable, and the switch collapses them to 0s, so motion is dropped rather
 * than shortened and a transition can never be caught mid-way.
 *
 * What CSS cannot do on its own is give an element that has just mounted a
 * closed frame to animate out of, or keep one that has just unmounted on
 * screen long enough to leave. Radix does both for shadcn's overlays; the two
 * hooks here are for the detail sheet, which is ours.
 */

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

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
 * detail sheets, which every board renders behind its own `selected &&`. Goes
 * on the element as `data-state`, which the `.mqs-slide-right` rule in
 * tokens.css animates between; the way out is useLeave's.
 */
export function useEnter(): PresenceState {
  const [state, setState] = useState<PresenceState>("closed");
  useEffect(() => afterFirstPaint(() => setState("open")), []);
  return state;
}

/**
 * The way out for an element its caller unmounts directly. React removes such
 * an element in the same commit that drops it from the tree, so there is
 * nothing left to animate: what leaves is a copy, taken just before, put back
 * where the element stood and switched to `data-state="closed"`.
 *
 * The copy is inert and goes when its transition ends. Scroll offsets are
 * carried across, or a sheet read halfway down would jump to its top on the
 * way out.
 */
export function useLeave(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    const parent = element?.parentNode;
    if (element == null || parent == null) return;
    // A copy still leaving from the last close would slide out across this one.
    parent.querySelectorAll(":scope > [data-leaving]").forEach((copy) => copy.remove());

    // Layout cleanup runs before React detaches the element, so it can still be read.
    return () => {
      if (document.documentElement.dataset.animations === "off") return;
      const next = element.nextSibling;
      const copy = element.cloneNode(true) as HTMLElement;
      const offsets: [number, number][] = [];
      element.querySelectorAll("*").forEach((node, i) => {
        if (node.scrollTop > 0) offsets.push([i, node.scrollTop]);
      });

      queueMicrotask(() => {
        // Still attached means StrictMode's rehearsal; a detached parent means
        // the whole board went, and there is nowhere to leave from.
        if (element.isConnected || !parent.isConnected) return;
        copy.dataset.leaving = "";
        copy.inert = true;
        parent.insertBefore(copy, next?.parentNode === parent ? next : null);
        const nodes = copy.querySelectorAll("*");
        for (const [i, top] of offsets) {
          const node = nodes[i];
          if (node != null) node.scrollTop = top;
        }
        // Read back so the open frame is committed and the change below runs from it.
        copy.getBoundingClientRect();
        copy.dataset.state = "closed";
        const remove = () => copy.remove();
        copy.addEventListener("transitionend", (event) => {
          if (event.target === copy) remove();
        });
        // A window that is not being painted never ends the transition.
        window.setTimeout(remove, 1000);
      });
    };
  }, [ref]);
}
