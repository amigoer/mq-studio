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
        actions={<Button variant="outline">{t("board.dlq.kafka.convention")}</Button>}
      />
      <Toolbar>
        <SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.kafka.source") }]} />
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.dlq.kafka.target")}
        </span>
        <SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.last24h") }]} />
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
              <TableHead style={R}>{t("board.common.partition")}</TableHead>
              <TableHead style={R}>Offset</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>{t("board.dlq.kafka.exception")}</TableHead>
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
                    <Checkbox checked={on} aria-label={row.offset} onCheckedChange={() => toggle(row.id)} />
                  </TableCell>
                  <TableCell className="mono3" style={{ ...R, color: dim }}>{row.partition}</TableCell>
                  <TableCell className="mono3" style={{ ...R, color: dim }}>{row.offset}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TableCell>
                  <TableCell style={{ color: on ? "var(--c-err-text)" : "var(--c-muted)", maxWidth: "230px" }}>{row.error}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TableCell>
                </TableRow>
              );
            })}
            <SkeletonRows colSpan={6} widths={["56%"]} />
          </TableBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.kafka.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Button>{t("board.dlq.kafka.resend")}</Button>
        <Button variant="outline">{t("board.dlq.kafka.changeTarget")}</Button>
        <Button variant="outline">{t("board.common.export")}</Button>
      </BulkBar>
    </Page>
  );
}
