import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PROTOCOLS, type ProtocolId } from "@/design/data/protocols";

const TONES = {
  ok: "bg-(--c-ok-tint) text-(--c-ok-text)",
  warn: "bg-(--c-warn-bg) text-(--c-warn-text-deep)",
  err: "bg-(--c-err-bg) text-(--c-err-text)",
  off: "bg-(--c-fill-zinc) text-(--c-muted-zinc)",
} as const;

export type StatusTone = keyof typeof TONES;

/** The tinted status pill (在线 / 堆积 / 掉线 / 离线). */
export function Status({
  tone = "ok",
  dot,
  className,
  children,
  ...props
}: {
  tone?: StatusTone;
  /** Online states carry a leading filled bullet. */
  dot?: boolean;
  className?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <Badge
      className={cn("rounded-full border-transparent px-2 font-normal", TONES[tone], className)}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </Badge>
  );
}

/** Per-protocol brand badge (RMQ / KFK / MQTT…). */
export function ProtoBadge({
  protocol,
  label,
  className,
  style,
}: {
  protocol: ProtocolId;
  label?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const p = PROTOCOLS[protocol];
  return (
    <Badge
      className={cn(
        "mono3 rounded border-transparent px-1.5 text-[10px] font-semibold tracking-[0.02em]",
        p.badgeClass,
        className,
      )}
      style={style}
    >
      {label ?? p.badge}
    </Badge>
  );
}

/** A bordered outline chip: version and licence marks in settings. */
export function OutlineTag({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="rounded px-1.5 text-[10px] font-normal text-muted-foreground">
      {children}
    </Badge>
  );
}
