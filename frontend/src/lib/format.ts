/**
 * Shared number formatting for metrics coming off the brokers.
 *
 * One rule everywhere: a negative value means the brokers never reported the
 * metric, and that is rendered as an em dash — never as zero. Four pages used
 * to carry their own near-copy of these helpers, and they disagreed on exactly
 * that point, so the same missing reading showed as "0" on one screen and "—"
 * on another.
 */

const UNKNOWN = "—";

function isUnknown(value: number): boolean {
  return !Number.isFinite(value) || value < 0;
}

/** Shorten to thousands once the digits stop being readable at a glance. */
function compact(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return Math.round(value).toLocaleString();
}

/** Throughput without a unit, for callers that style the "/s" separately. */
export function formatRate(value: number): string {
  return isUnknown(value) ? UNKNOWN : compact(value);
}

/** Throughput including the unit; stays a bare dash when unreported. */
export function formatRateWithUnit(value: number): string {
  return isUnknown(value) ? UNKNOWN : `${compact(value)}/s`;
}

/** Exact count with thousands separators. */
export function formatCount(value: number): string {
  return isUnknown(value) ? UNKNOWN : Math.round(value).toLocaleString();
}

/** Count that collapses to thousands past 10k — for lag and other big totals. */
export function formatCompactCount(value: number): string {
  if (isUnknown(value)) return UNKNOWN;
  return value >= 10000
    ? `${(value / 1000).toFixed(1)}k`
    : Math.round(value).toLocaleString();
}

/** Read/write queue pair, where either side may be unreported on its own. */
export function formatQueues(read: number, write: number): string {
  if (isUnknown(read) && isUnknown(write)) return UNKNOWN;
  if (isUnknown(read)) return `${UNKNOWN} / ${write}`;
  if (isUnknown(write)) return `${read} / ${UNKNOWN}`;
  return `${read} / ${write}`;
}

/**
 * A byte count at human scale.
 *
 * RabbitMQ reports memory and free disk in bytes, and the numbers are large
 * enough that the raw figure is unreadable: a node's memory limit is routinely
 * ten digits.
 */
export function formatBytes(value: number | string | undefined): string {
  const bytes = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (bytes == null || Number.isNaN(bytes) || isUnknown(bytes)) return UNKNOWN;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let scaled = bytes / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  // One decimal below ten keeps 1.5 GiB from reading as 2 GiB; above it the
  // fraction is noise.
  return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)} ${units[unit]}`;
}
