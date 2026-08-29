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
