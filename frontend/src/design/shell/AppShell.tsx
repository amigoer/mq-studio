import type { ReactNode } from "react";

/**
 * `.m3` — the whole window. The body wrapper is the positioning context for
 * every overlay in the canvas: detail sheets (3c), the new-connection modal
 * (3a) and the command palette (9d) all anchor to it.
 */
export function AppShell({
  titleBar,
  sidebar,
  children,
  overlays,
}: {
  titleBar: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
}) {
  return (
    <div className="m3">
      {titleBar}
      <div style={{ position: "relative", flex: 1, display: "flex", minHeight: 0 }}>
        {sidebar}
        {children}
        {overlays}
      </div>
    </div>
  );
}
