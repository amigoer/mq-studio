import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The hatched placeholder standing in for a plot that is not wired yet. */
export function ChartBox({
  children,
  className,
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "mono3 flex items-center justify-center rounded-lg border border-dashed border-(--c-border-dash) text-xs text-(--c-muted-2)",
        "bg-[repeating-linear-gradient(45deg,var(--c-panel),var(--c-panel)_8px,var(--c-fill-soft)_8px,var(--c-fill-soft)_16px)]",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
