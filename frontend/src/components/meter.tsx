import type { CSSProperties, ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** A thin utilisation bar on the shadcn Progress. */
export function Bar({
  value,
  color = "var(--c-ok)",
  className,
  style,
}: {
  /** 0-100. */
  value: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Progress
      value={Math.max(0, Math.min(100, value))}
      className={cn("h-1.5 bg-(--c-fill-mute)", className)}
      indicatorStyle={{ backgroundColor: color }}
      style={style}
    />
  );
}

/** Label + bar + percentage — the health/utilisation row on every overview. */
export function MeterRow({
  label,
  value,
  display,
  color,
  labelWidth = 84,
}: {
  label: ReactNode;
  /** 0-100. */
  value: number;
  /** Defaults to `${value}%`. */
  display?: string;
  color?: string;
  labelWidth?: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="mono3 flex-none" style={{ flexBasis: `${labelWidth}px` }}>
        {label}
      </span>
      <Bar value={value} color={color} className="flex-1" />
      <span className="mono3 flex-none text-muted-foreground">{display ?? `${value}%`}</span>
    </div>
  );
}
