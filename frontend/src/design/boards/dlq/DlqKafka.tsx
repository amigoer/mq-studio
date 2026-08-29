import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, SelectField, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { useTranslation } from "react-i18next";

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

type Row = { id: string; partition: string; offset: string; key: string; error: string; at: string };

const ROWS: readonly Row[] = [
  { id: "1082", partition: "0", offset: "1 082", key: "ORD-87990", error: "DeserializationException: unknown field", at: "09:41:22" },
  { id: "1083", partition: "2", offset: "1 083", key: "ORD-88102", error: "NPE at OrderService.java:112", at: "10:02:37" },
  { id: "1084", partition: "1", offset: "1 084", key: "ORD-88155", error: "TimeoutException: db", at: "10:18:03" },
];

/**
 * Board 15a — Kafka DLT. Discovered by the `.DLT` suffix convention; a single
 * record cannot be deleted, so cleanup is retention's job.
 */
export function DlqKafka() {
  const [checked, setChecked] = useState<string[]>(["1082", "1083"]);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === ROWS.length;

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.dlq.kafka.title")}
        subtitle={t("board.dlq.kafka.subtitle")}
        actions={<Btn>{t("board.dlq.kafka.convention")}</Btn>}
      />
      <Toolbar>
        <SelectField value={t("board.dlq.kafka.source")} />
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.dlq.kafka.target")}
        </span>
        <SelectField value={t("board.dlq.last24h")} />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">{t("board.common.query")}</Btn>
      </Toolbar>

      <ListPane>
        <Table className="inset">
          <THead>
            <TR>
              <TH style={{ width: "26px" }}>
                <Check
                  checked={allChecked}
                  label={t("board.common.selectAll")}
                  onChange={() => setChecked(allChecked ? [] : ROWS.map((r) => r.id))}
                />
              </TH>
              <TH style={R}>{t("board.common.partition")}</TH>
              <TH style={R}>Offset</TH>
              <TH>Key</TH>
              <TH>{t("board.dlq.kafka.exception")}</TH>
              <TH>{t("board.common.time")}</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "var(--c-mono-dim)";
              return (
                <TR key={row.id}>
                  <TD>
                    <Check checked={on} label={row.offset} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.partition}</TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.offset}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TD>
                  <TD style={{ color: on ? "var(--c-err-text)" : "var(--c-muted)", maxWidth: "230px" }}>{row.error}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={6} widths={["56%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.kafka.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Btn variant="primary">{t("board.dlq.kafka.resend")}</Btn>
        <Btn>{t("board.dlq.kafka.changeTarget")}</Btn>
        <Btn>{t("board.common.export")}</Btn>
      </BulkBar>
    </Page>
  );
}
