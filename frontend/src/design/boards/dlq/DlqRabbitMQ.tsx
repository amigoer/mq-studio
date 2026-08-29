import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, Seg, SelectField, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";

const REASONS = [
  { value: "all", label: "全部" },
  { value: "rejected", label: "rejected" },
  { value: "expired", label: "expired" },
  { value: "maxlen", label: "maxlen" },
] as const;

const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "#666" } as const;
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

  return (
    <Page>
      <PageHeader title="死信 DLX" subtitle="dlx.order → dlx.order.q · 37 条" />
      <Toolbar>
        <SelectField value="死信队列：dlx.order.q" />
        <Seg options={REASONS} value={reason} onChange={setReason} />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">获取 50 条</Btn>
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
              <TH>routing key</TH>
              <TH>原队列（x-death）</TH>
              <TH>原因</TH>
              <TH style={R}>count</TH>
              <TH>时间</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "#666";
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

      <BulkBar hint="重新发布 = 读取 + 按原 routing key 发布 + ack 原消息">
        <span>已选 {checked.length} 条</span>
        <Btn variant="primary">重新发布到原队列</Btn>
        <Btn>发布到其他队列…</Btn>
        <Btn>导出</Btn>
        <Btn variant="danger">ack 移除</Btn>
      </BulkBar>
    </Page>
  );
}
