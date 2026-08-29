import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Controls that own their click. Without this, hitting 刷新 or a filter in the
 * toolbar would dismiss the panel you are reading, which is not what "click the
 * blank area" means.
 */
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="tab"], [role="switch"], [role="menuitem"], [role="checkbox"]';

/**
 * The floating detail panel introduced in 3c. It is absolutely positioned
 * against the shell body, so it overlays the page header too rather than
 * squeezing the table's column widths.
 */
export function Sheet({
  width = 380,
  onDismiss,
  children,
  className,
  style,
}: {
  width?: number;
  /**
   * Clicking the blank area closes the panel, the way a master-detail list is
   * expected to behave. Clicking another row is not a dismissal — the row
   * handler has already retargeted the panel by the time this runs, so rows
   * are skipped rather than closing and reopening.
   */
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    // Bubble phase on the document, so React's root handler has already run.
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target == null || !target.isConnected) return;
      if (ref.current?.contains(target)) return;
      if (target.closest("tbody tr") != null) return;
      if (target.closest(INTERACTIVE) != null) return;
      dismiss.current?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current?.();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn("mqs-sheet", className)}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: `${width}px`,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderLeft: "1px solid #ebebeb",
        boxShadow: "-16px 0 44px rgba(0,0,0,.13)",
        overflow: "hidden",
        zIndex: 4,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SheetHeader({
  title,
  badge,
  tabs,
  activeTab,
  onTabChange,
  onClose,
}: {
  title: ReactNode;
  badge?: ReactNode;
  tabs?: readonly string[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onClose?: () => void;
}) {
  return (
    <div style={{ padding: "13px 16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <b className="mono3" style={{ fontSize: "13px" }}>
          {title}
        </b>
        {badge}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          style={{ color: "#a3a3a3", background: "none", border: "none", padding: 0, font: "inherit" }}
        >
          ×
        </button>
      </div>
      {tabs != null && (
        <div
          style={{
            display: "flex",
            gap: "14px",
            marginTop: "10px",
            borderBottom: "1px solid #ebebeb",
            fontSize: "12px",
          }}
        >
          {tabs.map((tab) => {
            const on = tab === activeTab;
            return (
              <span
                key={tab}
                role="tab"
                tabIndex={0}
                aria-selected={on}
                onClick={() => onTabChange?.(tab)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onTabChange?.(tab);
                  }
                }}
                style={
                  on
                    ? { padding: "0 2px 7px", borderBottom: "2px solid #171717", fontWeight: 500 }
                    : { padding: "0 2px 7px", color: "#8a8a8a" }
                }
              >
                {tab}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SheetBody({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="mqs-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "12px 16px",
        borderTop: "1px solid #ebebeb",
        background: "#fff",
      }}
    >
      {children}
    </div>
  );
}
