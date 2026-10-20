import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** The hue of a tile's icon: kept apart from the state colours on purpose. */
export type StatTone = "blue" | "violet" | "teal" | "orange" | "pink" | "slate";

/** The five-across KPI tile from the overview boards. */
export function StatTile({
  label,
  value,
  hint,
  valueColor,
  hintColor,
  icon: Icon,
  tone = "slate",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  valueColor?: string;
  hintColor?: string;
  /** A glyph for what the figure counts, set in a tile of `tone`. */
  icon?: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div data-slot="stat-tile" className="flex min-w-0 flex-col bg-card px-4 pt-3.5 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon != null && (
          <span
            className="flex size-6 flex-none items-center justify-center rounded-md"
            style={{ background: `var(--c-tone-${tone}-bg)`, color: `var(--c-tone-${tone})` }}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <div
        className="mt-2.5 truncate text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums"
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
