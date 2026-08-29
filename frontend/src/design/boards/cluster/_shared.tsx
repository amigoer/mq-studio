import type { ReactNode } from "react";
import { Bar, Card } from "@/design/ui";

/* `.mqs-nodegrid` in tokens.css: it drops to one column on a narrow shell. */
export const NODE_GRID = "mqs-nodegrid";

export const NODE_CARD = {
  padding: "13px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "9px",
} as const;

export const TABLE_CARD = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
} as const;

export type Meter = {
  label: ReactNode;
  value: number;
  color?: string;
  /** The canvas turns the label amber once a node crosses its watermark. */
  labelColor?: string;
};

/** A node tile: name + state badges + address, a metric line, then meters. */
export function NodeCard({
  name,
  badges,
  address,
  metrics,
  meters,
  dim,
  children,
}: {
  name: string;
  badges?: ReactNode;
  address?: ReactNode;
  metrics?: ReactNode;
  meters?: readonly Meter[];
  /** Slaves and replicas sit on a slightly recessed background (3f). */
  dim?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card style={{ ...NODE_CARD, background: dim ? "var(--c-panel)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <b className="mono3" style={{ fontSize: "12.5px" }}>
          {name}
        </b>
        {badges}
        <span style={{ flex: 1 }} />
        {address != null && (
          <span className="mono3" style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
            {address}
          </span>
        )}
      </div>
      {metrics != null && (
        <div style={{ display: "flex", gap: "16px", fontSize: "11.5px" }}>{metrics}</div>
      )}
      {meters?.map((m, i) => (
        <div
          key={i}
          style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--c-muted)" }}
        >
          <span style={{ flex: "none", color: m.labelColor }}>{m.label}</span>
          <Bar value={m.value} color={m.color} style={{ flex: 1 }} />
        </div>
      ))}
      {children}
    </Card>
  );
}

/** `入 <b>1 620/s</b>` — the bold-value metric fragment in a node card. */
export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label} <b className="mono3">{value}</b>
    </span>
  );
}
