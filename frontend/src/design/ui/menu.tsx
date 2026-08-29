import { useEffect, useRef, type ReactNode } from "react";

/** One item in the `⋯` row menu (8a). */
export function MenuItem({
  children,
  danger,
  active,
  onSelect,
}: {
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="mqs-menuitem"
      onClick={onSelect}
      style={{
        font: "inherit",
        fontSize: "12px",
        padding: "6px 10px",
        borderRadius: "6px",
        textAlign: "left",
        border: "none",
        background: active ? "#f5f5f5" : "transparent",
        color: danger ? "#dc2828" : "#525252",
      }}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <span style={{ height: "1px", background: "#ebebeb", margin: "4px 6px" }} />;
}

/** The floating panel anchored under the `⋯` button. */
export function Menu({
  open,
  onClose,
  children,
  width = 170,
  top = 26,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  width?: number;
  top?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "absolute",
        top: `${top}px`,
        right: 0,
        width: `${width}px`,
        background: "#fff",
        border: "1px solid #ebebeb",
        borderRadius: "10px",
        boxShadow: "0 10px 34px rgba(0,0,0,.14)",
        zIndex: 6,
        display: "flex",
        flexDirection: "column",
        padding: "5px",
        textAlign: "left",
      }}
    >
      {children}
    </div>
  );
}
