import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { PROTOCOLS, type ProtocolId } from "@/design/data/protocols";

/** `.st` status pill. */
const statusVariants = cva("st", {
  variants: {
    tone: { ok: "ok", warn: "warn", err: "err", off: "off" },
  },
  defaultVariants: { tone: "ok" },
});

export interface StatusProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusVariants> {
  /** The canvas prefixes online states with a filled bullet (`.mqs-dot`). */
  dot?: boolean;
}

export function Status({ className, tone, dot, children, ...props }: StatusProps) {
  return (
    <span className={cn(statusVariants({ tone }), className)} {...props}>
      {dot && <span className="mqs-dot" aria-hidden />}
      {children}
    </span>
  );
}

/** `.pb` protocol badge, coloured per protocol. */
export function ProtoBadge({
  protocol,
  label,
  className,
  style,
}: {
  protocol: ProtocolId;
  label?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const p = PROTOCOLS[protocol];
  return (
    <span className={cn("pb", p.badgeClass, className)} style={style}>
      {label ?? p.badge}
    </span>
  );
}

/** A bordered outline chip: version and licence marks in settings. */
export function OutlineTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        border: "1px solid var(--c-border)",
        borderRadius: "4px",
        padding: "1px 6px",
        color: "var(--c-muted)",
      }}
    >
      {children}
    </span>
  );
}

export { statusVariants };
