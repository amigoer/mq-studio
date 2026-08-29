import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, SelectField, Table, TBody, TD, TH, THead, TR } from "@/design/ui";

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
  { id: "a", scope: "orders:events / settle-group", entryId: "1756447200104-0", consumer: "settle-1", idle: "2.1h", idleColor: "#b91c1c", deliveries: "17", deliveryColor: "#b45309" },
  { id: "b", scope: "orders:events / settle-group", entryId: "1756450301882-3", consumer: "settle-1", idle: "1.2h", idleColor: "#b45309", deliveries: "9" },
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

  return (
    <Page>
      <PageHeader
        title="待确认 PEL"
        subtitle="idle ≥ 30 分钟的条目 · 5 条"
        actions={<SelectField value="阈值 30 分钟" />}
      />
      <Toolbar>
        <SelectField value="Stream：全部" />
        <SelectField value="组：全部" />
        <span style={{ flex: 1 }} />
        <Btn>XAUTOCLAIM 批量认领…</Btn>
      </Toolbar>

      <ListPane>
        <Table className="inset">
          <THead>
            <TR>
              <TH style={{ width: "26px" }}>
                <Check
                  checked={allChecked}
                  label="全选"
                  onChange={() => setChecked(allChecked ? [] : ROWS.map((r) => r.id))}
                />
              </TH>
              <TH>Stream / 组</TH>
              <TH>Entry ID</TH>
              <TH>consumer</TH>
              <TH style={R}>idle</TH>
              <TH style={R}>投递</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "#666";
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

      <BulkBar hint="认领会重置 idle 并 +1 投递计数">
        <span>已选 {checked.length} 条</span>
        <Btn variant="primary">
              XCLAIM 给 settle-2
              <ChevronDown size={12} aria-hidden />
            </Btn>
        <Btn>XACK 放弃</Btn>
        <Btn>查看消息</Btn>
      </BulkBar>
    </Page>
  );
}
