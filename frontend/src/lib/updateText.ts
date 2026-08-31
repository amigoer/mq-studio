import { Blocker } from "@/api/updates";

/**
 * The wording the update surfaces share.
 *
 * The settings card and the update dialog say the same things about the same
 * state, and a release that reads as 68.4 MB in one place and 65 MiB in the
 * other is the kind of difference a reader has to stop and resolve.
 */

/**
 * Bytes as a download line shows them.
 *
 * Deliberately not `lib/format.ts`'s `formatBytes`, which is binary (KiB, MiB)
 * because that is how brokers report memory. A download is measured against
 * what GitHub puts on the release page, and that is decimal-flavoured MB.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A date the release carries, in the reader's own locale, or "" if unparsable. */
export function formatDate(value: string, locale: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string, locale: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Why the app cannot replace itself here, said in the reader's terms. */
export function blockerKey(blocker: Blocker): string | null {
  switch (blocker) {
    case Blocker.BlockerPackageManager:
      return "update.blocked.packageManager";
    case Blocker.BlockerReadOnly:
      return "update.blocked.readOnly";
    case Blocker.BlockerNotPackaged:
      return "update.blocked.notPackaged";
    case Blocker.BlockerUnsupported:
      return "update.blocked.unsupported";
    default:
      return null;
  }
}

/** The locale the two panels format dates in, from the active language. */
export const updateLocale = (language: string): string =>
  language === "en" ? "en-US" : "zh-CN";
