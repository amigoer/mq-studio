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
  Segmented,
  SelectField,
  Status,
} from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
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
        <SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.rabbitmq.queue") }]} />
        <Segmented options={REASONS.map((o) => ({ ...o, label: t(o.label) }))} value={reason} onChange={setReason} />
        <span className="flex-1" />
        <Button>{t("board.dlq.rabbitmq.fetch50")}</Button>
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
              <TableHead>routing key</TableHead>
              <TableHead>{t("board.dlq.rabbitmq.originQueue")}</TableHead>
              <TableHead>{t("board.common.reason")}</TableHead>
              <TableHead style={R}>count</TableHead>
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
                    <Checkbox checked={on} aria-label={row.routingKey} onCheckedChange={() => toggle(row.id)} />
                  </TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.routingKey}</TableCell>
                  <TableCell className="mono3" style={DIM11}>{row.origin}</TableCell>
                  <TableCell>
                    <Status tone={row.reason === "rejected" ? "err" : "warn"} style={TAG}>
                      {row.reason}
                    </Status>
                  </TableCell>
                  <TableCell className="mono3" style={{ ...R, color: dim }}>{row.count}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TableCell>
                </TableRow>
              );
            })}
            <SkeletonRows colSpan={6} widths={["52%"]} />
          </TableBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.rabbitmq.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Button>{t("board.dlq.rabbitmq.republish")}</Button>
        <Button variant="outline">{t("board.dlq.rabbitmq.publishElsewhere")}</Button>
        <Button variant="outline">{t("board.common.export")}</Button>
        <Button variant="destructive">{t("board.common.ackRemove")}</Button>
      </BulkBar>
    </Page>
  );
}
