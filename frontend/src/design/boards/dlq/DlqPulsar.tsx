import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SelectField,
} from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
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
        <SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.pulsar.subscription") }]} />
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.dlq.pulsar.rule")}
        </span>
        <span className="flex-1" />
        <Button>{t("board.common.query")}</Button>
      </Toolbar>

      <ListPane>
        <Table inset>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: "26px" }}>
                <Checkbox
                  checked={allChecked}
                  aria-label={t("board.common.selectAll")}
                  onCheckedChange={() => setChecked(allChecked ? [] : ROWS.map((r) => r.id))}
                />
              </TableHead>
              <TableHead>MessageId</TableHead>
              <TableHead>Key</TableHead>
              <TableHead style={R}>{t("board.common.redeliver")}</TableHead>
              <TableHead>{t("board.dlq.pulsar.lastException")}</TableHead>
              <TableHead>{t("board.common.time")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "var(--c-mono-dim)";
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox checked={on} aria-label={row.messageId} onCheckedChange={() => toggle(row.id)} />
                  </TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.messageId}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TableCell>
                  <TableCell className="mono3" style={{ ...R, color: dim }}>{row.redeliveries}</TableCell>
                  <TableCell style={{ color: on ? "var(--c-err-text)" : "var(--c-muted)", maxWidth: "220px" }}>{row.error}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TableCell>
                </TableRow>
              );
            })}
            <SkeletonRows colSpan={6} widths={["50%"]} />
          </TableBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.pulsar.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Button>{t("board.dlq.pulsar.resend")}</Button>
        <Button variant="outline">{t("board.common.export")}</Button>
        <Button variant="destructive">{t("board.dlq.pulsar.discard")}</Button>
      </BulkBar>
    </Page>
  );
}
