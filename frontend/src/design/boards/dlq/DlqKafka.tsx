import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Btn, Check, SelectField, Table, TBody, TD, TH, THead, TR } from "@/design/ui";

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

  return (
    <Page>
      <PageHeader
        title="死信 DLT"
        subtitle="按 .DLT 后缀约定自动发现 · 3 个 DLT"
        actions={<Btn>配置约定…</Btn>}
      />
      <Toolbar>
        <SelectField value="源：orders.created" />
        <span className="mono3" style={{ fontSize: "11px", color: "#8a8a8a" }}>
          → orders.created.DLT（12 条）
        </span>
        <SelectField value="近 24 小时" />
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
              <TH style={R}>分区</TH>
              <TH style={R}>Offset</TH>
              <TH>Key</TH>
              <TH>异常（header）</TH>
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
                    <Check checked={on} label={row.offset} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.partition}</TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.offset}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TD>
                  <TD style={{ color: on ? "#b91c1c" : "#8a8a8a", maxWidth: "230px" }}>{row.error}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={6} widths={["56%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint="Kafka 不支持删除单条 · DLT 依赖 retention 清理">
        <span>已选 {checked.length} 条</span>
        <Btn variant="primary">重发到 orders.created</Btn>
        <Btn>改目标 Topic…</Btn>
        <Btn>导出</Btn>
      </BulkBar>
    </Page>
  );
}
