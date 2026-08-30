import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

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
    <Card className="gap-0 px-3.5 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="mt-0.5 text-[1.615rem] leading-tight font-semibold tracking-tight"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {hint != null && (
        <div className="mt-0.5 text-[10.5px]" style={{ color: hintColor ?? "var(--c-muted)" }}>
          {hint}
        </div>
      )}
    </Card>
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
    <Card className="gap-0 rounded-lg px-3 py-2">
      <div className="text-[10.5px] text-muted-foreground">{label}</div>
      <div
        className="mono3 mt-0.5 font-semibold"
        style={{ fontSize: `${size / 13}rem`, color }}
      >
        {value}
      </div>
    </Card>
  );
}
