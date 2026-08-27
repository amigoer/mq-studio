/**
 * Nullability helpers for the Wails bindings.
 *
 * Go pointer returns are generated as `T | null`, but the services only return
 * nil alongside an error, which the bindings surface as a rejected promise. The
 * helpers below turn that guarantee into types the pages can rely on, and fail
 * loudly rather than silently if it is ever broken.
 */

/** Unwraps a pointer result that the service guarantees to be non-nil. */
export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("backend returned an empty result");
  return value;
}

/** Drops the nullable element type from a slice result. */
export function present<T>(values: (T | null)[] | null | undefined): T[] {
  if (values == null) return [];
  return values.filter((value): value is T => value != null);
}
