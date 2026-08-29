import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, SelectField, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { useTranslation } from "react-i18next";

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

type Row = {
  id: string;
  scope: string;
  entryId: string;
  consumer: string;
  idle: string;
  idleColor?: string;
  deliveries: string;
  deliveryColor?: string;
};

const ROWS: readonly Row[] = [
  { id: "a", scope: "orders:events / settle-group", entryId: "1756447200104-0", consumer: "settle-1", idle: "2.1h", idleColor: "var(--c-err-text)", deliveries: "17", deliveryColor: "var(--c-warn-text)" },
  { id: "b", scope: "orders:events / settle-group", entryId: "1756450301882-3", consumer: "settle-1", idle: "1.2h", idleColor: "var(--c-warn-text)", deliveries: "9" },
  { id: "c", scope: "payments:captured / audit-group", entryId: "1756451877210-0", consumer: "audit-1", idle: "42m", deliveries: "3" },
];

/**
 * Board 15d — Redis has no dead-letter queue; the nearest thing is a PEL entry
 * that has been idle past a threshold, so this page is the claim/ack console.
 */
export function PelRedis() {
  const [checked, setChecked] = useState<string[]>(["a", "b"]);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === ROWS.length;

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.dlq.redis.title")}
        subtitle={t("board.dlq.redis.subtitle")}
        actions={<SelectField value={t("board.dlq.redis.threshold")} />}
      />
      <Toolbar>
        <SelectField value={t("board.dlq.redis.allStreams")} />
        <SelectField value={t("board.dlq.redis.allGroups")} />
        <span style={{ flex: 1 }} />
        <Btn>{t("board.dlq.redis.autoclaim")}</Btn>
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
              <TH>{t("board.dlq.redis.streamGroup")}</TH>
              <TH>Entry ID</TH>
              <TH>consumer</TH>
              <TH style={R}>idle</TH>
              <TH style={R}>{t("board.dlq.redis.deliveries")}</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "var(--c-mono-dim)";
              return (
                <TR key={row.id}>
                  <TD>
                    <Check checked={on} label={row.entryId} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.scope}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.entryId}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.consumer}</TD>
                  <TD className="mono3" style={{ ...R, color: on ? row.idleColor : dim }}>{row.idle}</TD>
                  <TD className="mono3" style={{ ...R, color: on ? row.deliveryColor : dim }}>
                    {row.deliveries}
                  </TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={6} widths={["48%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.redis.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Btn variant="primary">
              {t("board.dlq.redis.claimTo")}
              <ChevronDown size={12} aria-hidden />
            </Btn>
        <Btn>{t("board.dlq.redis.xackDrop")}</Btn>
        <Btn>{t("board.common.viewMessages")}</Btn>
      </BulkBar>
    </Page>
  );
}
