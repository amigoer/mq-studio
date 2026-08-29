import { useCallback, useRef, useState, type CSSProperties } from "react";

export interface Series {
  /** Shown in the legend and the tooltip; never identified by colour alone. */
  label: string;
  /** A `var(--c-series-N)` token, in the palette's fixed order. */
  color: string;
  /** One value per timestamp; null where nothing was sampled. */
  values: readonly (number | null)[];
}

const VIEW_W = 600;
const VIEW_H = 160;
const PAD_TOP = 8;
const PAD_BOTTOM = 16;

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * A time-series line chart.
 *
 * Both series carry the same unit, so they share one axis. Two scales on one
 * plot would let either line be moved anywhere relative to the other by
 * choosing the scales, which is the fastest way to draw a comparison that is
 * not true.
 *
 * The stroke is kept at 2px under the viewBox's scaling by
 * `vector-effect`, so the chart can stretch to whatever room the card has
 * without thickening its own lines.
 */
export function LineChart({
  series,
  timestamps,
  formatValue = (value) => value.toLocaleString(),
  formatTime,
  style,
}: {
  series: readonly Series[];
  timestamps: readonly number[];
  formatValue?: (value: number) => string;
  formatTime: (timestamp: number) => string;
  style?: CSSProperties;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const count = timestamps.length;
  const peak = niceCeiling(
    Math.max(
      1,
      ...series.flatMap((one) => one.values.map((value) => value ?? 0)),
    ),
  );

  const x = (index: number) => (count <= 1 ? 0 : (index / (count - 1)) * VIEW_W);
  const y = (value: number) =>
    PAD_TOP + (1 - value / peak) * (VIEW_H - PAD_TOP - PAD_BOTTOM);

  // A gap in the samples breaks the line rather than being bridged, so a
  // window where nothing was collected does not read as a flat reading.
  const pathOf = (values: readonly (number | null)[]) => {
    let path = "";
    let pen = false;
    values.forEach((value, index) => {
      if (value == null) {
        pen = false;
        return;
      }
      path += `${pen ? "L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
      pen = true;
    });
    return path;
  };

  const onMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const box = svgRef.current?.getBoundingClientRect();
      if (box == null || box.width === 0 || count === 0) return;
      const ratio = (event.clientX - box.left) / box.width;
      setHover(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))));
    },
    [count],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", ...style }}>
      <div style={{ display: "flex", gap: "14px", fontSize: "10.5px", flexWrap: "wrap" }}>
        {series.map((one) => {
          const latest = [...one.values].reverse().find((value) => value != null);
          return (
            <span key={one.label} style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
              <span
                aria-hidden
                style={{
                  width: "9px",
                  height: "2px",
                  borderRadius: "2px",
                  background: one.color,
                }}
              />
              <span style={{ color: "var(--c-muted)" }}>{one.label}</span>
              {/* The current value as a direct label: the legend answers "what
                  is it now" without moving the pointer onto the plot. */}
              <b className="mono3" style={{ color: "var(--c-fg-2)" }}>
                {latest == null ? "—" : formatValue(latest)}
              </b>
            </span>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          role="img"
          aria-label={series.map((one) => one.label).join(" / ")}
          style={{ display: "block", overflow: "visible", touchAction: "none" }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={VIEW_W}
              y1={y(peak * fraction)}
              y2={y(peak * fraction)}
              stroke="var(--c-rule)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_TOP}
              y2={VIEW_H - PAD_BOTTOM}
              stroke="var(--c-border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {series.map((one) => (
            <path
              key={one.label}
              d={pathOf(one.values)}
              fill="none"
              stroke={one.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hover != null &&
            series.map((one) => {
              const value = one.values[hover];
              if (value == null) return null;
              return (
                <circle
                  key={`dot-${one.label}`}
                  cx={x(hover)}
                  cy={y(value)}
                  r={4}
                  fill={one.color}
                  // A ring in the surface colour keeps two dots readable where
                  // the series cross.
                  stroke="var(--c-bg)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
        </svg>

        {hover != null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              // Flip across the midpoint so the tooltip never leaves the card.
              left: hover / Math.max(1, count - 1) > 0.6 ? undefined : `${(hover / Math.max(1, count - 1)) * 100}%`,
              right: hover / Math.max(1, count - 1) > 0.6 ? `${(1 - hover / Math.max(1, count - 1)) * 100}%` : undefined,
              transform: hover / Math.max(1, count - 1) > 0.6 ? "translateX(-8px)" : "translateX(8px)",
              pointerEvents: "none",
              background: "var(--c-bg)",
              border: "1px solid var(--c-border)",
              borderRadius: "6px",
              padding: "6px 8px",
              fontSize: "10.5px",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ color: "var(--c-muted)", marginBottom: "3px" }}>
              {formatTime(timestamps[hover]!)}
            </div>
            {series.map((one) => (
              <div key={`tip-${one.label}`} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span
                  aria-hidden
                  style={{ width: "9px", height: "2px", borderRadius: "2px", background: one.color }}
                />
                <span style={{ color: "var(--c-muted)" }}>{one.label}</span>
                <b className="mono3" style={{ marginLeft: "auto", color: "var(--c-fg)" }}>
                  {one.values[hover] == null ? "—" : formatValue(one.values[hover]!)}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
