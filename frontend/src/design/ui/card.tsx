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

/** The five-across KPI tile from the overview boards. */
export function StatTile({
  label,
  value,
  hint,
  valueColor,
  hintColor,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  valueColor?: string;
  hintColor?: string;
}) {
  return (
    <Card style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: "21px",
          fontWeight: 600,
          marginTop: "3px",
          letterSpacing: "-.02em",
          color: valueColor,
        }}
      >
        {value}
      </div>
      {hint != null && (
        <div style={{ fontSize: "10.5px", color: hintColor ?? "var(--c-muted)", marginTop: "2px" }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

/** The compact metric tile used inside detail sheets. */
export function MiniStat({
  label,
  value,
  color,
  size = 16,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  color?: string;
  /** Font size of the value; the canvas uses 16px in 3c/9a and 15px in 12a/14a. */
  size?: number;
}) {
  return (
    <Card style={{ padding: "9px 12px" }}>
      <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{label}</div>
      <div
        className="mono3"
        style={{ fontSize: `${size}px`, fontWeight: 600, marginTop: "2px", color }}
      >
        {value}
      </div>
    </Card>
  );
}
