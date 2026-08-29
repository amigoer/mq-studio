import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { usePresence } from "@/lib/motion";

/**
 * The modal from 3a: a 32%-black scrim filling the shell body with a 580px
 * card centred on it. Scoped to the body rather than the viewport so the
 * title bar and tab strip stay reachable, exactly as drawn.
 */
export function Dialog({
  open,
  title,
  width = 580,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  width?: number;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  // Held past `open` so the card can leave the way it arrived; usePresence
  // drops the wait when 界面过渡动画 is off.
  const { mounted, state } = usePresence(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div
      className="mqs-scrim"
      data-state={state}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--c-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={typeof title === "string" ? title : undefined}
        className="card3 mqs-pop"
        data-state={state}
        style={{
          width: `${width}px`,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid var(--c-border)",
          }}
        >
          <b style={{ fontSize: "14px" }}>{title}</b>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            style={{ display: "flex", color: "var(--c-muted-2)", background: "none", border: "none", padding: 0 }}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {children}
        </div>
        {footer != null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "13px 20px",
              borderTop: "1px solid var(--c-border)",
              background: "var(--c-panel)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
