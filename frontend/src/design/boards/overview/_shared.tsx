import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Btn, SelectField } from "@/design/ui";
import { PageHeader } from "@/design/shell";

/** Every overview board carries the same time-range + refresh actions. */
export function OverviewHeader({ subtitle }: { subtitle: ReactNode }) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t("board.common.overview")}
      subtitle={subtitle}
      actions={
        <>
          <SelectField value={t("board.common.lastHour")} />
          <Btn>{t("board.common.refresh")}</Btn>
        </>
      }
    />
  );
}

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

export const TABLE_CARD = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
} as const;

/** The "查看全部" link in a table-card header, arrow included. */
export function ViewAll({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--c-fg-2)" }}>
      {children ?? t("board.common.viewAll")}
      <ArrowRight size={13} aria-hidden />
    </span>
  );
}

/** The mono, muted secondary cell used for topic/queue names in TOP tables. */
export const NAME_CELL = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
