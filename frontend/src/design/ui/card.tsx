import * as React from "react";
import { cn } from "@/lib/utils";

/** `.card3` — 12px radius, hairline border, 1px ambient shadow. */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("card3", className)} {...props} />
));
Card.displayName = "Card";

/** The card header row used by every chart and table card in the canvas. */
export function CardHeader({
  title,
  action,
  style,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "11px 16px",
        borderBottom: "1px solid var(--c-border)",
        ...style,
      }}
    >
      <b style={{ fontSize: "12.5px" }}>{title}</b>
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}
