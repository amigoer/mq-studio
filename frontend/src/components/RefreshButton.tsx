import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCallback, useState } from "react";
import { cn, formatErrorMessage, withMinDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** One full turn ≈ this duration; keep in sync with `.mqs-refresh-spin` in styles/app.css */
export const REFRESH_SPIN_MS = 700;

export interface RefreshButtonProps {
  onClick?: () => void | Promise<void>;
  /** Controlled spinning state (if omitted, use with usePageRefresh) */
  spinning?: boolean;
  disabled?: boolean;
  /** Show text label next to icon (e.g. Overview) */
  label?: string;
  /** Icon-only outline button (default) vs ghost with optional label */
  variant?: "icon" | "ghost";
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Unified refresh control: same icon keeps rotating while busy
 * (smooth full turns, not a hard swap to a different spinner).
 */
export function RefreshButton({
  onClick,
  spinning = false,
  disabled = false,
  label,
  variant = "icon",
  size = 14,
  className,
  title,
}: RefreshButtonProps) {
  const { t } = useTranslation();
  const tip = title ?? t("common.refresh");

  return (
    <Button
      type="button"
      variant={variant === "icon" ? "outline" : "ghost"}
      size={variant === "icon" ? "icon-sm" : "sm"}
      className={className}
      onClick={() => void onClick?.()}
      disabled={disabled || spinning}
      title={tip}
      aria-label={tip}
      aria-busy={spinning}
    >
      <RefreshCw
        size={size}
        className={cn("mqs-refresh-icon", spinning && "mqs-refresh-spin")}
      />
      {label}
    </Button>
  );
}

/**
 * Shared refresh runner: min spin duration + deduped toast.
 * Pass a silent data refresh so the icon stays controlled here.
 */
export function usePageRefresh(run: () => Promise<unknown>) {
  const { t } = useTranslation();
  const [spinning, setSpinning] = useState(false);

  const refresh = useCallback(async () => {
    if (spinning) return;
    setSpinning(true);
    try {
      await withMinDuration(Promise.resolve(run()), REFRESH_SPIN_MS);
      toast.success(t("common.refreshed"), {
        id: "page-refresh",
        duration: 1800,
      });
    } catch (e) {
      toast.error(formatErrorMessage(e), { id: "page-refresh" });
    } finally {
      setSpinning(false);
    }
  }, [run, spinning, t]);

  return { spinning, refresh };
}
