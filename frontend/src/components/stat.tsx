import type { ReactNode } from "react";

/** The five-across KPI tile from the overview boards. */
export function StatTile({
  label,
  value,
  hint,
  valueColor,
  hintColor,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  valueColor?: string;
  hintColor?: string;
}) {
  return (
    <div data-slot="stat-tile" className="flex min-w-0 flex-col bg-card px-4 pt-3.5 pb-3">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        className="mt-1.5 truncate text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {/* Held open when empty, so a row of tiles keeps one baseline. */}
      <div
        className="mt-2 min-h-[1.45em] truncate text-[11px]"
        style={{ color: hintColor ?? "var(--c-muted)" }}
      >
        {hint}
      </div>
    </div>
  );
}

/** The compact metric tile used inside detail panels. */
export function MiniStat({
  label,
  value,
  color,
  size = 16,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  /** Font size of the value in design px. */
  size?: number;
}) {
  return (
    <div data-slot="mini-stat" className="min-w-0 rounded-lg bg-(--c-fill-soft) px-3 py-2.5 ring-1 ring-(--c-rule) ring-inset">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div
        className="mt-1 truncate leading-tight font-semibold tracking-[-0.01em] tabular-nums"
        style={{ fontSize: `${(size + 1) / 13}rem`, color }}
      >
        {value}
      </div>
    </div>
  );
}
