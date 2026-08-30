/*
 * The UI scale ladder.
 *
 * The design canvas is drawn in absolute px, so a larger window only stretched
 * the shell's widths - type, padding and row height stayed where the canvas put
 * them, and the whole UI read as too small on anything but the artboard's own
 * size. useUIScale zooms the document to one of these sizes instead; this module
 * is the arithmetic behind the ladder, kept apart from the DOM so it can be
 * tested on its own.
 */

/** The size the canvas was drawn at. Every step on the ladder is relative to it. */
export const BASE_FONT_SIZE = 13;

/** The ladder the settings row offers and the zoom commands walk, in px. */
export const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20] as const;

export type FontSize = (typeof FONT_SIZES)[number];

/** `auto` follows the window; a number pins the size the user picked. */
export type UIScaleSetting = "auto" | FontSize;

/** The artboard the canvas was drawn at. */
const DESIGN_WIDTH = 1180;
const DESIGN_HEIGHT = 764;

/**
 * The largest step that still leaves the canvas's own artboard's worth of room
 * in both axes, so scaling up never squeezes a board tighter than it was drawn.
 *
 * Auto only grows. Shrinking below 13px would take the canvas's 10.5px captions
 * down with it; a window too small for the drawn size is what the breakpoints in
 * tokens.css are for.
 */
export function autoFontSize(width: number, height: number): FontSize {
  const fit = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  let chosen: FontSize = BASE_FONT_SIZE;
  for (const size of FONT_SIZES) {
    if (size > chosen && size / BASE_FONT_SIZE <= fit) chosen = size;
  }
  return chosen;
}

/** Reads a stored or transported scale, falling back to `auto`. */
export function parseUIScale(value: string | null | undefined): UIScaleSetting {
  if (value == null || value === "auto") return "auto";
  const size = Number(value);
  return (FONT_SIZES as readonly number[]).includes(size) ? (size as FontSize) : "auto";
}

/** One step along the ladder, stopping at either end rather than wrapping. */
export function stepFrom(size: FontSize, direction: 1 | -1): FontSize {
  const index = FONT_SIZES.indexOf(size);
  const bounded = Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction));
  return FONT_SIZES[bounded] ?? size;
}

export function scaleOf(size: FontSize): number {
  return size / BASE_FONT_SIZE;
}
