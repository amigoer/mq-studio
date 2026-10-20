/* Both are `.mqs-kpis` / `.mqs-chartrow` in tokens.css: the room the shell has
   decides how they lay out, which an inline style could not answer. */
export const KPI_GRID = "mqs-kpis";
export const CHART_ROW = "mqs-chartrow";

export const CHART_CARD = {
  padding: "13px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
} as const;
