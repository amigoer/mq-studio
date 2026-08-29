import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, Seg, SelectField, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { useTranslation } from "react-i18next";

const REASONS = [
  { value: "all", label: "board.common.all" },
  { value: "rejected", label: "board.term.rejected" },
  { value: "expired", label: "board.term.expired" },
  { value: "maxlen", label: "board.term.maxlen" },
] as const;

const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const TAG = { fontSize: "10px" } as const;
const R = { textAlign: "right" } as const;

type Row = {
  id: string;
  routingKey: string;
  origin: string;
  reason: "rejected" | "expired";
  count: string;
  at: string;
};

const ROWS: readonly Row[] = [
  { id: "a", routingKey: "order.created", origin: "order.settle.q", reason: "rejected", count: "2", at: "10:02:37" },
  { id: "b", routingKey: "order.created", origin: "order.settle.q", reason: "rejected", count: "2", at: "10:14:08" },
  { id: "c", routingKey: "order.updated", origin: "order.notify.q", reason: "expired", count: "1", at: "10:18:03" },
];

/** Board 15b — RabbitMQ DLX queue; x-death carries the origin and the reason. */
export function DlqRabbitMQ() {
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("all");
  const [checked, setChecked] = useState<string[]>(["a", "b"]);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === ROWS.length;

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.dlq.rabbitmq.title")} subtitle={t("board.dlq.rabbitmq.subtitle")} />
      <Toolbar>
        <SelectField value={t("board.dlq.rabbitmq.queue")} />
        <Seg options={REASONS.map((o) => ({ ...o, label: t(o.label) }))} value={reason} onChange={setReason} />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">{t("board.dlq.rabbitmq.fetch50")}</Btn>
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
              <TH>routing key</TH>
              <TH>{t("board.dlq.rabbitmq.originQueue")}</TH>
              <TH>{t("board.common.reason")}</TH>
              <TH style={R}>count</TH>
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
                    <Check checked={on} label={row.routingKey} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.routingKey}</TD>
                  <TD className="mono3" style={DIM11}>{row.origin}</TD>
                  <TD>
                    <Status tone={row.reason === "rejected" ? "err" : "warn"} style={TAG}>
                      {row.reason}
                    </Status>
                  </TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.count}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={6} widths={["52%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.rabbitmq.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Btn variant="primary">{t("board.dlq.rabbitmq.republish")}</Btn>
        <Btn>{t("board.dlq.rabbitmq.publishElsewhere")}</Btn>
        <Btn>{t("board.common.export")}</Btn>
        <Btn variant="danger">{t("board.common.ackRemove")}</Btn>
      </BulkBar>
    </Page>
  );
}
