import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The 92px label / value grid used by every detail panel. */
export function KV({
  rows,
  className,
  style,
}: {
  rows: readonly (readonly [ReactNode, ReactNode])[];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[92px_1fr] items-baseline gap-x-2.5 gap-y-[5px] text-xs",
        className,
      )}
      style={style}
    >
      {rows.map(([key, value], i) => (
        <Fragment key={i}>
          <span className="text-muted-foreground">{key}</span>
          <span>{value}</span>
        </Fragment>
      ))}
    </div>
  );
}
