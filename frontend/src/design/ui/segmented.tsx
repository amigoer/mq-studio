import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegOption<T extends string> = { value: T; label: ReactNode };

/** `.seg` — the small segmented control (时间范围, 视图切换…). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
  style,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("seg", className)} style={style} role="tablist">
      {options.map((o) => (
        <span
          key={o.value}
          role="tab"
          tabIndex={0}
          aria-selected={o.value === value}
          className={o.value === value ? "on" : undefined}
          onClick={() => onChange?.(o.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onChange?.(o.value);
            }
          }}
        >
          {o.label}
        </span>
      ))}
    </div>
  );
}
