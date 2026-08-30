/*
 * The font stacks the interface and monospace settings resolve to. Shared by
 * the settings preview and by the CSS variables the shell reads, so what the
 * preview shows is what the rest of the window gets.
 */

/** The canvas's own stack: the CJK faces matter as much as the Latin ones. */
export const SYSTEM_UI_STACK =
  "-apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

export const SYSTEM_MONO_STACK = "ui-monospace, Menlo, Consolas, monospace";

/** "system" is a choice on both menus, not a family any host would resolve. */
export function uiFontStack(family: string): string {
  const name = family.trim();
  return !name || name === "system" ? SYSTEM_UI_STACK : `"${name}", ${SYSTEM_UI_STACK}`;
}

export function monoFontStack(family: string): string {
  const name = family.trim();
  return !name || name === "system" ? SYSTEM_MONO_STACK : `"${name}", ${SYSTEM_MONO_STACK}`;
}

/*
 * Which families the host actually has.
 *
 * Measured rather than asked for: document.fonts.check() answers for the whole
 * fallback chain and returns true for a name no machine has ever carried. A
 * missing family renders in the generic it falls back to, so a family whose
 * measurements differ from every generic's is one the host resolved itself.
 *
 * The probe mixes Latin and CJK because these menus are mostly CJK faces: a
 * Latin-only string cannot tell 苹方 from the sans-serif it would fall back to
 * on a machine that has neither.
 */
const PROBE = "mMwWiIlL01@#gjpqy 中文字形测试";
const GENERICS = ["monospace", "sans-serif", "serif"] as const;

/** Families the interface menu offers, wherever the host has them. */
export const UI_FONT_CANDIDATES = [
  "Inter",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans SC",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "HarmonyOS Sans",
  "Segoe UI",
  "Helvetica Neue",
  "Roboto",
  "Ubuntu",
  "WenQuanYi Micro Hei",
] as const;

/** The same for the monospace menu. */
export const MONO_FONT_CANDIDATES = [
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Cascadia Code",
  "Cascadia Mono",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "IBM Plex Mono",
  "Roboto Mono",
  "DejaVu Sans Mono",
  "Ubuntu Mono",
] as const;

/** One probe per family for the life of the window; the answer cannot change. */
const answered = new Map<string, boolean>();

function probe(family: string): boolean {
  const context = document.createElement("canvas").getContext("2d");
  // No canvas to measure on: offer the whole menu rather than an empty one.
  if (context == null) return true;
  return GENERICS.some((generic) => {
    context.font = `72px ${generic}`;
    const fallback = context.measureText(PROBE).width;
    context.font = `72px "${family}", ${generic}`;
    return context.measureText(PROBE).width !== fallback;
  });
}

export function isFontAvailable(family: string): boolean {
  if (typeof document === "undefined") return true;
  const known = answered.get(family);
  if (known !== undefined) return known;
  const found = probe(family);
  answered.set(family, found);
  return found;
}

/**
 * The candidates this machine can actually render, with `keep` appended if the
 * host does not have it -- a family that arrived with an imported config, or
 * was chosen on another machine, must stay visible as the current value rather
 * than silently reading as something it is not.
 */
export function availableFonts(
  candidates: readonly string[],
  keep?: string,
): { family: string; installed: boolean }[] {
  const out = candidates
    .filter((family) => isFontAvailable(family))
    .map((family) => ({ family, installed: true }));
  if (keep != null && keep !== "system" && !out.some((f) => f.family === keep)) {
    out.push({ family: keep, installed: false });
  }
  return out;
}
