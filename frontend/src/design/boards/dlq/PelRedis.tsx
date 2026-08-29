import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
        actions={<SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.redis.threshold") }]} />}
      />
      <Toolbar>
        <SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.redis.allStreams") }]} />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.dlq.redis.allGroups") }]} />
        <span className="flex-1" />
        <Button variant="outline">{t("board.dlq.redis.autoclaim")}</Button>
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
              <TableHead>{t("board.dlq.redis.streamGroup")}</TableHead>
              <TableHead>Entry ID</TableHead>
              <TableHead>consumer</TableHead>
              <TableHead style={R}>idle</TableHead>
              <TableHead style={R}>{t("board.dlq.redis.deliveries")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "var(--c-mono-dim)";
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox checked={on} aria-label={row.entryId} onCheckedChange={() => toggle(row.id)} />
                  </TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.scope}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.entryId}</TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: dim }}>{row.consumer}</TableCell>
                  <TableCell className="mono3" style={{ ...R, color: on ? row.idleColor : dim }}>{row.idle}</TableCell>
                  <TableCell className="mono3" style={{ ...R, color: on ? row.deliveryColor : dim }}>
                    {row.deliveries}
                  </TableCell>
                </TableRow>
              );
            })}
            <SkeletonRows colSpan={6} widths={["48%"]} />
          </TableBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.dlq.redis.hint")}>
        <span>{t("board.common.selectedN", { n: checked.length })}</span>
        <Button>
              {t("board.dlq.redis.claimTo")}
              <ChevronDown size={12} aria-hidden />
            </Button>
        <Button variant="outline">{t("board.dlq.redis.xackDrop")}</Button>
        <Button variant="outline">{t("board.common.viewMessages")}</Button>
      </BulkBar>
    </Page>
  );
}
