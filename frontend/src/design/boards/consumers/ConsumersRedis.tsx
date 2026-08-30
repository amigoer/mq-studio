import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BulkBar, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
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
  SectionLabel,
  SelectField,
} from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";

const R = { textAlign: "right" } as const;
const MONO11 = { fontSize: "11px" } as const;

type PelEntry = {
  id: string;
  consumer: string;
  idle: string;
  idleColor?: string;
  deliveries: string;
  deliveryColor?: string;
};

const PEL: readonly PelEntry[] = [
  { id: "1756447200104-0", consumer: "settle-1", idle: "2.1h", idleColor: "var(--c-err-text)", deliveries: "17", deliveryColor: "var(--c-warn-text)" },
  { id: "1756450301882-3", consumer: "settle-1", idle: "1.2h", deliveries: "9" },
  { id: "1756453988012-1", consumer: "settle-2", idle: "11m", deliveries: "2" },
];

/**
 * Board 14c — Redis consumer groups. Below the group table sits the selected
 * group's PEL, because claiming and acking is the whole job here.
 */
export function ConsumersRedis() {
  const [selectedGroup, setSelectedGroup] = useState("settle-group");
  const [checked, setChecked] = useState<string[]>(PEL.slice(0, 1).map((e) => e.id));

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === PEL.length;

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.consumerGroup")} subtitle={t("board.consumers.redis.subtitle")} />
      <Toolbar>
        <SelectField value="orders:events" prefix="Stream：" options={[{ value: "orders:events" }]} />
        <span className="flex-1" />
        <Button variant="outline">XAUTOCLAIM idle&gt;60s…</Button>
      </Toolbar>

      <div style={{ flex: "none", overflow: "hidden" }}>
        <Table inset>
          <TableHeader>
            <TableRow>
              <TableHead>{t("board.common.group")}</TableHead>
              <TableHead style={R}>consumers</TableHead>
              <TableHead style={R}>pending</TableHead>
              <TableHead>last-delivered-id</TableHead>
              <TableHead style={R}>entries-read</TableHead>
              <TableHead style={R}>{t("board.consumers.redis.lag")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow selected={selectedGroup === "settle-group"} onClick={() => setSelectedGroup("settle-group")}>
              <TableCell><b style={{ fontWeight: 500 }}>settle-group</b></TableCell>
              <TableCell className="mono3" style={R}>2</TableCell>
              <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>29</TableCell>
              <TableCell className="mono3" style={MONO11}>1756454641773-2</TableCell>
              <TableCell className="mono3" style={R}>1 204 742</TableCell>
              <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>982</TableCell>
            </TableRow>
            <TableRow selected={selectedGroup === "notify-group"} onClick={() => setSelectedGroup("notify-group")}>
              <TableCell>notify-group</TableCell>
              <TableCell className="mono3" style={R}>3</TableCell>
              <TableCell className="mono3" style={R}>6</TableCell>
              <TableCell className="mono3" style={MONO11}>1756454646018-0</TableCell>
              <TableCell className="mono3" style={R}>1 204 771</TableCell>
              <TableCell className="mono3" style={R}>0</TableCell>
            </TableRow>
            <TableRow selected={selectedGroup === "audit-group"} onClick={() => setSelectedGroup("audit-group")}>
              <TableCell>audit-group</TableCell>
              <TableCell className="mono3" style={R}>1</TableCell>
              <TableCell className="mono3" style={R}>2</TableCell>
              <TableCell className="mono3" style={MONO11}>1756454640031-5</TableCell>
              <TableCell className="mono3" style={R}>1 204 512</TableCell>
              <TableCell className="mono3" style={R}>259</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 20px 6px" }}>
        <SectionLabel>{t("board.consumers.redis.pelOf", { group: selectedGroup })}</SectionLabel>
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>{t("board.consumers.redis.bulkHint")}</span>
      </div>

      <ListPane>
        <Table inset>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: "26px" }}>
                <Checkbox
                  checked={allChecked}
                  aria-label={t("board.common.selectAll")}
                  onCheckedChange={() => setChecked(allChecked ? [] : PEL.map((p) => p.id))}
                />
              </TableHead>
              <TableHead>Entry ID</TableHead>
              <TableHead>consumer</TableHead>
              <TableHead style={R}>idle</TableHead>
              <TableHead style={R}>{t("board.consumers.redis.deliveries")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PEL.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Checkbox
                    checked={checked.includes(e.id)}
                    aria-label={e.id}
                    onCheckedChange={() => toggle(e.id)}
                  />
                </TableCell>
                <TableCell className="mono3" style={MONO11}>{e.id}</TableCell>
                <TableCell className="mono3" style={MONO11}>{e.consumer}</TableCell>
                <TableCell className="mono3" style={{ ...R, color: e.idleColor }}>{e.idle}</TableCell>
                <TableCell className="mono3" style={{ ...R, color: e.deliveryColor }}>{e.deliveries}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListPane>

      <BulkBar hint={t("board.consumers.redis.idleHint")}>
        <span>{t("board.consumers.redis.selected", { n: checked.length })}</span>
        <Button>
              {t("board.consumers.redis.claimTo")}
              <ChevronDown size={12} aria-hidden />
            </Button>
        <Button variant="outline">{t("board.consumers.redis.xack")}</Button>
      </BulkBar>

    </Page>
  );
}
