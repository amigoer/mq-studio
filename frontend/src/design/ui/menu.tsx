import { useEffect, useRef, type ReactNode } from "react";

/** One item in the row overflow menu (8a). */
export function MenuItem({
  children,
  danger,
  active,
  disabled,
  onSelect,
}: {
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="mqs-menuitem"
      disabled={disabled}
      onClick={onSelect}
      style={{
        font: "inherit",
        fontSize: "12px",
        /* A row, so an item that carries an icon keeps it on the label's line. */
        display: "flex",
        alignItems: "center",
        gap: "5px",
        padding: "6px 10px",
        borderRadius: "6px",
        textAlign: "left",
        border: "none",
        background: active ? "var(--c-fill)" : "transparent",
        color: disabled === true
          ? "var(--c-disabled)"
          : danger === true
            ? "var(--c-err)"
            : "var(--c-fg-2)",
      }}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <span style={{ height: "1px", background: "var(--c-border)", margin: "4px 6px" }} />;
}

/** The floating panel anchored under the row overflow button. */
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
        background: "var(--c-bg)",
        border: "1px solid var(--c-border)",
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
