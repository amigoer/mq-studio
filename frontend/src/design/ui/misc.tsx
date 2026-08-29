import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Check as CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** `.chart3` — the hatched placeholder the canvas uses for every plot. */
export function ChartBox({
  children,
  className,
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("chart3", className)} style={style}>
      {children}
    </div>
  );
}

/** `.bar3` — a thin progress/utilisation bar. */
export function Bar({
  value,
  color = "var(--c-ok)",
  className,
  style,
}: {
  /** 0-100. */
  value: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("bar3", className)} style={style}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

/** `.ph3` — the grey text-skeleton block. */
export function Placeholder({ width, style }: { width?: number | string; style?: CSSProperties }) {
  return <div className="ph3" style={{ width, ...style }} />;
}

/** `.sec3` — uppercase section label, optionally with a right-floated action. */
export function SectionLabel({
  children,
  action,
  actionColor = "var(--c-ok)",
  style,
}: {
  children: ReactNode;
  action?: ReactNode;
  actionColor?: string;
  style?: CSSProperties;
}) {
  return (
    <div className="sec3" style={style}>
      {children}
      {action != null && (
        <span
          style={{
            float: "right",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            color: actionColor,
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          {action}
        </span>
      )}
    </div>
  );
}

/** `.kv3` — the 92px label / value grid used by every detail sheet. */
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
    <div className={cn("kv3", className)} style={style}>
      {rows.map(([k, v], i) => (
        <Fragment key={i}>
          <span className="k">{k}</span>
          <span>{v}</span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * `.srow` — a settings row: label and hint on the left, controls on the right.
 * The last row of a card drops its rule so the card's own border is the only
 * line under it.
 */
export function SettingRow({
  label,
  hint,
  children,
  last,
  style,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  last?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="srow" style={last ? { borderBottom: "none", ...style } : style}>
      <div className="lab">
        <div>{label}</div>
        {hint != null && <div className="hint">{hint}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "none" }}>
        {children}
      </div>
    </div>
  );
}

/** Label + `.bar3` + percentage — the health/utilisation row on every overview. */
export function MeterRow({
  label,
  value,
  display,
  color,
  labelWidth = 84,
}: {
  label: ReactNode;
  /** 0-100. */
  value: number;
  /** Defaults to `${value}%`. */
  display?: string;
  color?: string;
  labelWidth?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
      <span className="mono3" style={{ flex: `0 0 ${labelWidth}px` }}>
        {label}
      </span>
      <Bar value={value} color={color} style={{ flex: 1 }} />
      <span className="mono3" style={{ color: "var(--c-muted)", flex: "none" }}>
        {display ?? `${value}%`}
      </span>
    </div>
  );
}

/** The 12px square checkbox drawn in the 14c PEL table. */
export function Check({
  checked,
  onChange,
  label,
}: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={Boolean(checked)}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      style={
        checked
          ? {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "12px",
              height: "12px",
              borderRadius: "3px",
              background: "var(--c-fg)",
              color: "var(--c-bg)",
              border: "none",
              padding: 0,
            }
          : {
              display: "inline-block",
              width: "12px",
              height: "12px",
              border: "1.4px solid var(--c-disabled)",
              borderRadius: "3px",
              background: "transparent",
              padding: 0,
            }
      }
    >
      {checked && <CheckIcon size={9} strokeWidth={3} aria-hidden />}
    </button>
  );
}

/** The amber caution strip above a destructive tool (13b's ack mode warning). */
export function WarnBanner({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        margin: "0 20px",
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        border: "1px solid var(--c-warn-border)",
        background: "var(--c-warn-bg-soft)",
        borderRadius: "8px",
        fontSize: "11.5px",
        color: "var(--c-warn-text-deep)",
        flex: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
