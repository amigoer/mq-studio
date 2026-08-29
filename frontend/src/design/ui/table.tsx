import * as React from "react";
import { cn } from "@/lib/utils";

/** `.t3` — the one table style in the canvas. */
export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table ref={ref} className={cn("t3", className)} {...props} />
));
Table.displayName = "Table";

/** `.t3.mini` — the compact variant used inside detail sheets. */
export const MiniTable = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table ref={ref} className={cn("t3", "mini", className)} {...props} />
));
MiniTable.displayName = "MiniTable";

export const THead = (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead {...props} />
);
export const TBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody {...props} />
);

export const TR = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }
>(({ className, selected, ...props }, ref) => (
  <tr ref={ref} className={cn(selected && "sel", className)} {...props} />
));
TR.displayName = "TR";

export const TH = (props: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...props} />;
export const TD = (props: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...props} />;

/** Right-aligned numeric cell, always monospace as drawn. */
export const NumTD = ({
  className,
  style,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("mono3", className)} style={{ textAlign: "right", ...style }} {...props} />
);

/** Monospaced identifier cell (topic names, addresses, message ids). */
export const MonoTD = ({
  className,
  style,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("mono3", className)} style={{ fontSize: "11px", color: "#666", ...style }} {...props} />
);
