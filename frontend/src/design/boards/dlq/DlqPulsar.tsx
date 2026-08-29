import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, SelectField, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { useTranslation } from "react-i18next";

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

type Row = { id: string; messageId: string; key: string; redeliveries: string; error: string; at: string };

const ROWS: readonly Row[] = [
  { id: "799", messageId: "799:2:0", key: "ORD-87990", redeliveries: "5", error: "SchemaSerializationException", at: "09:41:22" },
  { id: "801", messageId: "801:6:1", key: "ORD-88102", redeliveries: "5", error: "TimeoutException: db", at: "10:02:37" },
];

/** Board 15c — Pulsar DLQ, one per subscription once maxRedeliverCount trips. */
export function DlqPulsar() {
  const [checked, setChecked] = useState<string[]>(["799"]);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === ROWS.length;

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.dlq.pulsar.title")}
        subtitle={t("board.dlq.pulsar.subtitle")}
      />
      <Toolbar>
        <SelectField value={t("board.dlq.pulsar.subscription")} />
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.dlq.pulsar.rule")}
        </span>
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
              <TH>MessageId</TH>
              <TH>Key</TH>
              <TH style={R}>{t("board.common.redeliver")}</TH>
              <TH>{t("board.dlq.pulsar.lastException")}</TH>
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
                    <Check checked={on} label={row.messageId} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.messageId}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.redeliveries}</TD>
                  <TD style={{ color: on ? "var(--c-err-text)" : "var(--c-muted)", maxWidth: "220px" }}>{row.error}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={6} widths={["50%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.pulsar.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Btn variant="primary">{t("board.dlq.pulsar.resend")}</Btn>
        <Btn>{t("board.common.export")}</Btn>
        <Btn variant="danger">{t("board.dlq.pulsar.discard")}</Btn>
      </BulkBar>
    </Page>
  );
}
