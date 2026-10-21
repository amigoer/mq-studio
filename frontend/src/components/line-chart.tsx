import { useId, type CSSProperties } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

interface Series {
  /** Shown in the legend and the tooltip; never identified by colour alone. */
  label: string;
  /** A `var(--c-series-N)` token, in the palette's fixed order. */
  color: string;
  /** One value per timestamp; null where nothing was sampled. */
  values: readonly (number | null)[];
}

/**
 * The throughput time-series plot, on the shadcn chart (recharts).
 *
 * All series share one axis: two scales on one plot would let either line be
 * moved anywhere relative to the other by choosing the scales. A window the
 * collector never sampled stays null and breaks the line rather than being
 * bridged or plotted as zero.
 *
 * Each line carries a faint wash down to the axis, which is what lets two
 * lines that sit on top of each other still read as two volumes. The legend is
 * not drawn here: the card puts `SeriesLegend` beside its own title.
 */
export function LineChart({
  series,
  timestamps,
  formatValue = (value) => value.toLocaleString(),
  formatTime,
  className,
  style,
}: {
  series: readonly Series[];
  timestamps: readonly number[];
  formatValue?: (value: number) => string;
  formatTime: (timestamp: number) => string;
  className?: string;
  style?: CSSProperties;
}) {
  const data = timestamps.map((ts, index) => {
    const row: Record<string, number | null> = { ts };
    series.forEach((one, key) => {
      row[`s${key}`] = one.values[index] ?? null;
    });
    return row;
  });
  const config = Object.fromEntries(
    series.map((one, key) => [`s${key}`, { label: one.label, color: one.color }]),
  ) satisfies ChartConfig;
  const gradient = useId().replace(/:/g, "");

  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto min-h-0 w-full", className)}
      style={style}
    >
      <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          {series.map((_, key) => (
            <linearGradient key={key} id={`${gradient}-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--color-s${key})`} stopOpacity={0.14} />
              <stop offset="100%" stopColor={`var(--color-s${key})`} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--c-rule)" />
        <XAxis
          dataKey="ts"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          minTickGap={48}
          fontSize={11}
          tickFormatter={(value: number) => formatTime(value)}
        />
        {/* Sized to its longest label: at a fixed 48px, "24,000/s" lost its
            leading digit and the axis read 4,000 above 8,000. */}
        <YAxis
          width="auto"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          tickFormatter={(value: number) => formatValue(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const ts = payload?.[0]?.payload?.ts as number | undefined;
                return ts == null ? "" : formatTime(ts);
              }}
              formatter={(value, name) => (
                <>
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: `var(--color-${name})` }}
                  />
                  <span className="text-muted-foreground">
                    {config[name as keyof typeof config]?.label ?? name}
                  </span>
                  <span className="mono3 ml-auto font-medium tabular-nums">
                    {formatValue(Number(value))}
                  </span>
                </>
              )}
            />
          }
        />
        {series.map((_, key) => (
          <Area
            key={key}
            dataKey={`s${key}`}
            type="monotone"
            stroke={`var(--color-s${key})`}
            strokeWidth={1.75}
            fill={`url(#${gradient}-${key})`}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

/** The key to a chart's series, set in the card header beside its title. */
export function SeriesLegend({
  series,
  className,
}: {
  series: readonly Pick<Series, "label" | "color">[];
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3.5 text-xs text-muted-foreground", className)}>
      {series.map((one) => (
        <span key={one.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: one.color }} aria-hidden />
          {one.label}
        </span>
      ))}
    </div>
  );
}
