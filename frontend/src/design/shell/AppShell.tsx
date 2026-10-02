import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

/** The assistant's dock: open or not, and how wide the person left it. */
export type Dock = {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  /** Dragging the dock shut is closing it. */
  onClose: () => void;
  content: ReactNode;
};

export const DOCK_MIN = 340;
export const DOCK_MAX = 560;

/*
 * Below this much room beside the dock, the page would be squeezed past use
 * even with the navigation down to its rail, so the dock goes over the page
 * instead of beside it: the rail's 57px and the narrowest page worth showing.
 */
const BESIDE_THE_DOCK = 57 + 680;

/**
 * `.m3` — the whole window. The body wrapper is the positioning context for
 * the overlays in the canvas - the new-connection modal (3a) and the command
 * palette (9d) - and the content wrapper for the detail sheets (3c), which
 * must stop at the dock rather than cover it.
 *
 * The dock is always laid out, collapsed when shut, so opening it never
 * remounts the page beside it.
 */
export function AppShell({
  titleBar,
  sidebar,
  children,
  overlays,
  dock,
}: {
  titleBar: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
  dock?: Dock;
}) {
  const body = useRef<HTMLDivElement>(null);
  const panel = usePanelRef();
  const [room, setRoom] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = body.current;
    if (element == null || typeof ResizeObserver === "undefined") return;
    // clientWidth is in the page's own px, the ones the dock's width is set
    // in, whatever the interface scale has zoomed the document to.
    const observer = new ResizeObserver(() => setRoom(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const open = dock?.open ?? false;
  const width = dock?.width ?? DOCK_MIN;
  const over = open && room != null && room - width < BESIDE_THE_DOCK;
  const beside = open && !over;
  // Not a dependency below: the width changes under the person's drag, and
  // resizing to it on every change would fight the drag.
  const chosen = useRef(width);
  chosen.current = width;

  /*
   * The dock is as wide as the person left it, whatever the window does. The
   * panels share a window resize out in proportion, so the width is put back
   * after every one - and only a drag ever changes what is kept.
   */
  useEffect(() => {
    const handle = panel.current;
    if (handle == null) return;
    if (beside) handle.resize(chosen.current);
    else handle.collapse();
  }, [beside, room, panel]);

  const main = (
    <div className="mqs-main">
      {sidebar}
      <div className="mqs-content">{children}</div>
    </div>
  );

  return (
    <div className="m3">
      {titleBar}
      <div ref={body} style={{ position: "relative", flex: 1, display: "flex", minHeight: 0 }}>
        {dock == null ? (
          main
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            onLayoutChanged={(_, change) => {
              if (!change.isUserInteraction || !beside) return;
              const size = Math.round(panel.current?.getSize().inPixels ?? 0);
              if (size === 0) dock.onClose();
              else dock.onWidthChange(size);
            }}
          >
            <ResizablePanel id="main" style={{ display: "flex", overflow: "hidden" }}>
              {main}
            </ResizablePanel>
            <ResizableHandle disabled={!beside} className={beside ? undefined : "hidden"} />
            <ResizablePanel
              id="dock"
              panelRef={panel}
              collapsible
              collapsedSize={0}
              minSize={DOCK_MIN}
              maxSize={DOCK_MAX}
              defaultSize={beside ? width : 0}
              style={{ display: "flex", overflow: "hidden" }}
            >
              {beside && dock.content}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        {over && dock != null && (
          <div className="mqs-dock-over" style={{ width: Math.min(width, (room ?? width) - 48) }}>
            {dock.content}
          </div>
        )}
        {overlays}
      </div>
    </div>
  );
}
