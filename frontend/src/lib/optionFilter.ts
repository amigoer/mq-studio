/** What a dropdown should render for one query. */
export interface FilterResult {
  items: string[];
  /** Matches beyond the render cap. Zero when everything matched is shown. */
  hidden: number;
}

/**
 * Rendering every option of a cluster with a thousand topics costs a thousand
 * DOM nodes on each open, and nobody scrolls that far anyway.
 */
const DEFAULT_LIMIT = 200;

/** Exact match, then prefix, then anywhere — the order a typist expects. */
function rank(candidate: string, needle: string): number {
  if (candidate === needle) return 0;
  if (candidate.startsWith(needle)) return 1;
  return candidate.includes(needle) ? 2 : -1;
}

/**
 * Filters and ranks `options` against `query`, capped at `limit`.
 *
 * Matching is case-insensitive; ties keep the caller's order, so an
 * alphabetically sorted input stays alphabetical within each rank.
 */
export function filterOptions(
  options: string[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): FilterResult {
  const needle = query.trim().toLowerCase();
  let matched: string[];
  if (needle === "") {
    matched = options;
  } else {
    const ranked: { option: string; rank: number; index: number }[] = [];
    options.forEach((option, index) => {
      const r = rank(option.toLowerCase(), needle);
      if (r >= 0) ranked.push({ option, rank: r, index });
    });
    ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
    matched = ranked.map((entry) => entry.option);
  }
  if (matched.length <= limit) return { items: matched, hidden: 0 };
  return { items: matched.slice(0, limit), hidden: matched.length - limit };
}
