import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, SelectField, Table, TBody, TD, TH, THead, TR } from "@/design/ui";

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

  return (
    <Page>
      <PageHeader
        title="死信 DLQ"
        subtitle="订阅 settle-sub · order-created-settle-sub-DLQ · 8 条"
      />
      <Toolbar>
        <SelectField value="订阅：settle-sub" />
        <span className="mono3" style={{ fontSize: "11px", color: "#8a8a8a" }}>
          maxRedeliverCount=5 · 超限入 DLQ
        </span>
        <span style={{ flex: 1 }} />
        <Btn variant="primary">查询</Btn>
      </Toolbar>

      <ListPane>
        <Table>
          <THead>
            <TR>
              <TH style={{ width: "26px" }}>
                <Check
                  checked={allChecked}
                  label="全选"
                  onChange={() => setChecked(allChecked ? [] : ROWS.map((r) => r.id))}
                />
              </TH>
              <TH>MessageId</TH>
              <TH>Key</TH>
              <TH style={R}>重投递</TH>
              <TH>最后异常（properties）</TH>
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
                    <Check checked={on} label={row.messageId} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.messageId}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.redeliveries}</TD>
                  <TD style={{ color: on ? "#b91c1c" : "#8a8a8a", maxWidth: "220px" }}>{row.error}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={6} widths={["50%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint="丢弃 = 在 DLQ 上 ack · 源订阅不受影响">
        <span>已选 {checked.length} 条</span>
        <Btn variant="primary">重发到源 Topic</Btn>
        <Btn>导出</Btn>
        <Btn variant="danger">确认丢弃</Btn>
      </BulkBar>
    </Page>
  );
}
