/**
 * What an alert record reads as, in the current language.
 *
 * A record stores a rule and its numbers, never a sentence -- it can outlive
 * the language it fired in, and the popover keeps recovered rows around for
 * half an hour. Every string the bell and the alerts page draw is chosen here,
 * from the record, at render.
 */
import type { TFunction } from "i18next";
import type { AlertRecord } from "@/lib/alertCenter";
import { formatCount } from "@/lib/format";
import type { TimezonePref } from "@/lib/time";

/** Numbers reach the locale strings already grouped: `12,043`, not `12043`. */
function readable(
  params: Readonly<Record<string, string | number>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "number" ? formatCount(value) : value;
  }
  return out;
}

/** Everything the text helpers need: a stored record or a fresh derivation. */
export type AlertLike = Pick<AlertRecord, "ruleKey" | "params">;

/** The popover's bold line: the rule, said about its subject. */
export function alertHeadline(t: TFunction, record: AlertLike): string {
  return t(`alerts.headline.${record.ruleKey}`, readable(record.params));
}

/** The alerts page's generic rule name, with no subject in it. */
export function alertTitle(t: TFunction, record: AlertLike): string {
  return t(`alerts.rule.${record.ruleKey}`);
}

/** The alerts page's detail line: subject and figures. */
export function alertBody(t: TFunction, record: AlertLike): string {
  return t(`alerts.detail.${record.ruleKey}`, readable(record.params));
}

/**
 * The measurement drawn beside the headline in mono, where there is one.
 *
 * Disk carries its percentage inside the headline instead -- "broker-b 磁盘水位
 * 87%" reads as one phrase, and splitting the figure out of it would not.
 */
export function alertValue(record: AlertLike): string | undefined {
  const { params, ruleKey } = record;
  if (ruleKey === "groupLag" || ruleKey === "groupOffline") {
    return typeof params.lag === "number" ? formatCount(params.lag) : undefined;
  }
  if (ruleKey === "dlqGrowth") {
    return typeof params.count === "number" ? formatCount(params.count) : undefined;
  }
  return undefined;
}

function clock(epochMs: number, timezone: TimezonePref): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone === "utc" ? "UTC" : undefined,
    }).format(new Date(epochMs));
  } catch {
    return "";
  }
}

/**
 * How long it has been firing, in the coarsest unit that still says something.
 *
 * Abbreviated on purpose: `18 min` and `18 分钟` both work without plural
 * rules, which the rest of the bundle also avoids.
 */
function duration(t: TFunction, elapsedMs: number): string | undefined {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return undefined;
  if (minutes < 60) return t("alerts.duration.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("alerts.duration.hours", { count: hours });
  return t("alerts.duration.days", { count: Math.floor(hours / 24) });
}

/** The threshold the rule fired against, for the rules that have one. */
function threshold(t: TFunction, record: AlertRecord): string | undefined {
  const value = record.params.threshold;
  if (value == null) return undefined;
  return record.ruleKey === "diskUsage"
    ? t("alerts.meta.thresholdPercent", { value })
    : t("alerts.meta.threshold", { value: formatCount(Number(value)) });
}

/**
 * The muted second line: `阈值 500 · 持续 18 分钟 · 10:24`, or the window a
 * recovered alert occupied.
 */
export function alertMeta(
  t: TFunction,
  record: AlertRecord,
  options: { now?: number; timezone?: TimezonePref } = {},
): string {
  const { now = Date.now(), timezone = "local" } = options;
  if (record.resolvedAt != null) {
    return `${clock(record.firstSeen, timezone)} - ${clock(record.resolvedAt, timezone)}`;
  }
  return [
    threshold(t, record),
    duration(t, now - record.firstSeen),
    clock(record.firstSeen, timezone),
  ]
    .filter((part): part is string => part != null && part !== "")
    .join(" · ");
}
