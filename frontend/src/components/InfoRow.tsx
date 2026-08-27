import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Label/value pair in a detail panel's key-value list.
 *
 * The label column is sized in rem rather than a fixed 120px so it keeps pace
 * with the font-size setting instead of clipping longer labels.
 */
export function InfoRow({
  label,
  children,
  /** Ids, hosts, timestamps — anything worth aligning character by character. */
  mono,
  valueClassName,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[9.25rem_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
      <div className="text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-foreground",
          mono && "font-mono-design text-fs-12",
          valueClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
