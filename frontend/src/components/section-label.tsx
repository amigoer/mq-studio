import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Uppercase section label, optionally with a right-aligned action. */
export function SectionLabel({
  children,
  action,
  actionColor = "var(--c-ok)",
  className,
  style,
}: {
  children: ReactNode;
  action?: ReactNode;
  actionColor?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "flex items-center text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase",
        className,
      )}
      style={style}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action != null && (
        <span
          className="inline-flex items-center gap-1 font-medium tracking-normal normal-case"
          style={{ color: actionColor }}
        >
          {action}
        </span>
      )}
    </div>
  );
}
