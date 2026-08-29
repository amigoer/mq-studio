import type { ReactNode } from "react";
import { Btn, SelectField } from "@/design/ui";
import { PageHeader } from "@/design/shell";

/** Every overview board carries the same time-range + refresh actions. */
export function OverviewHeader({ subtitle }: { subtitle: ReactNode }) {
  return (
    <PageHeader
      title="总览"
      subtitle={subtitle}
      actions={
        <>
          <SelectField value="近 1 小时" />
          <Btn>刷新</Btn>
        </>
      }
    />
  );
}

export const KPI_GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(5,1fr)",
  gap: "12px",
} as const;

export const CHART_ROW = {
  display: "grid",
  gridTemplateColumns: "1.7fr 1fr",
  gap: "12px",
  height: "168px",
  flex: "none",
} as const;

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

/** "查看全部 →" link in a table-card header. */
export function ViewAll({ children = "查看全部 →" }: { children?: ReactNode }) {
  return <span style={{ fontSize: "11.5px", color: "#525252" }}>{children}</span>;
}

/** The mono, muted secondary cell used for topic/queue names in TOP tables. */
export const NAME_CELL = { fontSize: "11px", color: "#666" } as const;
