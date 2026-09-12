import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * The label / value grid used by every detail panel.
 *
 * The label column has a floor rather than a fixed width. It was 92px flat,
 * which is right for "Broker" and "Rack" and wrong for a Kafka topic setting:
 * compression.gzip.level does not fit, and a grid cell does not clip, so the
 * key was painted straight over its own value. Both halves wrap rather than
 * overflow, for the case where neither fits.
 *
 * It has a ceiling too. Sized to its longest label alone, a Kafka broker's
 * config list gave the keys 367px of a 407px sheet, and every value wrapped a
 * character at a time down the 30px that was left.
 */
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
        "grid grid-cols-[fit-content(60%)_1fr] items-baseline gap-x-2.5 gap-y-[5px] text-xs",
        className,
      )}
      style={style}
    >
      {rows.map(([key, value], i) => (
        <Fragment key={i}>
          {/* An explicit min-width, not min-w-0: it is the column's floor, and
              it keeps an unbreakable label from pushing past the ceiling. */}
          <span className="min-w-[92px] break-words text-muted-foreground">{key}</span>
          <span className="min-w-0 break-words">{value}</span>
        </Fragment>
      ))}
    </div>
  );
}
