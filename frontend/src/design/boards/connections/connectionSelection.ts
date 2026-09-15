import type { Connection } from "@/design/data/connections";
import type { ConnectionOp } from "@/hooks/useConnectionProfiles";

/** What the selection bar can do to several connections at once. */
export const BULK_ACTIONS = ["connect", "disconnect", "test", "delete"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/**
 * The selection after a click on one row's checkbox.
 *
 * A range click sets every row from the anchor to the clicked one to the state
 * the clicked row is moving to, so shift-clicking back over the same rows clears
 * them again. With no anchor still on screen it is a plain toggle.
 */
export function clickSelection(
  selected: ReadonlySet<string>,
  rows: readonly Connection[],
  key: string,
  anchor: string | null,
  range: boolean,
): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(key);
  const set = (k: string) => (on ? next.add(k) : next.delete(k));
  const from = range && anchor != null ? rows.findIndex((c) => c.key === anchor) : -1;
  const to = rows.findIndex((c) => c.key === key);
  if (from < 0 || to < 0) {
    set(key);
    return next;
  }
  for (const c of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) set(c.key);
  return next;
}

/** The header checkbox: ticked, clear, or the partial state Radix draws as a dash. */
export function headerChecked(
  rows: readonly Connection[],
  selected: ReadonlySet<string>,
): boolean | "indeterminate" {
  const ticked = rows.filter((c) => selected.has(c.key)).length;
  if (ticked === 0) return false;
  return ticked === rows.length ? true : "indeterminate";
}

/**
 * The selected connections an action would actually reach.
 *
 * A row that is already dialling is left alone, the same as its own button.
 * Delete is the exception, as it is in the row's menu: removing a profile does
 * not wait on whatever the dial was doing.
 */
export function bulkTargets(
  action: BulkAction,
  connections: readonly Connection[],
  pending: Readonly<Record<number, ConnectionOp | undefined>> = {},
): Connection[] {
  if (action === "delete") return [...connections];
  return connections.filter((c) => {
    if (pending[c.id] != null) return false;
    if (action === "connect") return c.status !== "online";
    if (action === "disconnect") return c.status === "online";
    return true;
  });
}

/**
 * The order a bulk delete runs in, and the profile it has to leave behind.
 *
 * DeleteConnection refuses the default profile while any other one remains.
 * Taken last it goes through when every profile is selected, since by then it
 * is the only one left; otherwise it is kept out rather than sent to fail.
 */
export function deletePlan(
  targets: readonly Connection[],
  total: number,
): { order: Connection[]; kept?: Connection } {
  const defaultProfile = targets.find((c) => c.isDefault);
  const order = targets.filter((c) => !c.isDefault);
  if (defaultProfile == null) return { order };
  return targets.length === total
    ? { order: [...order, defaultProfile] }
    : { order, kept: defaultProfile };
}
