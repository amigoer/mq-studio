import type { CSSProperties } from "react";
import { CartesianGrid, Line, LineChart as RechartsLineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export interface Series {
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

  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto min-h-0 w-full", className)}
      style={style}
    >
      <RechartsLineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="ts"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          minTickGap={48}
          fontSize={11}
          tickFormatter={(value: number) => formatTime(value)}
        />
        <YAxis
          width={48}
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
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((_, key) => (
          <Line
            key={key}
            dataKey={`s${key}`}
            type="linear"
            stroke={`var(--color-s${key})`}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </RechartsLineChart>
    </ChartContainer>
  );
}
