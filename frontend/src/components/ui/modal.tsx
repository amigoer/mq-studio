import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
} as const;

export interface ModalProps {
  open: boolean;
  title: string;
  /** Rendered under the title and wired up as the dialog's accessible description. */
  description?: string;
  size?: keyof typeof SIZES;
  /** `alertdialog` for destructive confirmations, so screen readers interrupt. */
  role?: "dialog" | "alertdialog";
  /** Set false while a submit is in flight to block Escape and backdrop dismissal. */
  dismissible?: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * The one dialog shell: Escape, focus trap, focus restore, labelling and
 * entrance animation live here so every modal in the app behaves the same.
 *
 * Rendered through a portal on purpose. Page content sits inside
 * `PageTransition`, whose fill-mode keeps a `transform` on the wrapper even
 * after the animation ends — that makes the wrapper a containing block, and a
 * `position: fixed` backdrop nested inside it would only cover the main pane
 * instead of the window.
 *
 * Mark the element that should receive initial focus with `data-autofocus`;
 * otherwise the first focusable element wins.
 */
export function Modal({
  open,
  title,
  description,
  size = "md",
  role = "dialog",
  dismissible = true,
  onClose,
  children,
  footer,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;

    const initial =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!dismissible) return;
        // Stop here so the page-level Esc handler cannot also dismiss the
        // detail panel sitting behind this dialog.
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreTo?.focus?.();
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm duration-150 animate-in fade-in"
      // mousedown, not click: a drag that starts inside the panel and ends on
      // the backdrop must not close the dialog.
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "scroll-thin max-h-[calc(100vh-6rem)] w-full overflow-y-auto rounded-xl border border-border/50 bg-background p-6 shadow-lg duration-150 animate-in fade-in zoom-in-95",
          SIZES[size],
        )}
      >
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {title}
        </h2>
        {description && (
          <p
            id={descriptionId}
            className="mt-2 text-fs-125 leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        )}
        {children}
        {footer && (
          <div className="mt-5 flex justify-end gap-2.5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
