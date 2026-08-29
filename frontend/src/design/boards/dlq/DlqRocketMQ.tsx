import { useState } from "react";
import { BulkBar, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Check,
  Seg,
  SelectField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const VIEWS = [
  { value: "retry", label: "重试队列 (37)" },
  { value: "dlq", label: "死信队列 (12)" },
] as const;

const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "#666" } as const;
const R = { textAlign: "right" } as const;

type Row = {
  id: string;
  msgId: string;
  topic: string;
  key: string;
  retries: string;
  reason: string;
  at: string;
};

const ROWS: readonly Row[] = [
  { id: "9A1", msgId: "7F00…9A1", topic: "ORDER_CREATE", key: "ORD-87990", retries: "16", reason: "RemotingTimeout: 3000ms", at: "09:41:22" },
  { id: "9A4", msgId: "7F00…9A4", topic: "ORDER_CREATE", key: "ORD-88102", retries: "16", reason: "NPE at OrderService.java:112", at: "10:02:37" },
  { id: "9B0", msgId: "7F00…9B0", topic: "ORDER_CREATE", key: "ORD-88155", retries: "16", reason: "DB connection refused", at: "10:18:03" },
];

/**
 * Board 9b — RocketMQ %RETRY% / %DLQ%. Redelivery writes a fresh MsgId and
 * leaves the original in place, so the confirm step spells that out.
 */
export function DlqRocketMQ() {
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("dlq");
  const [checked, setChecked] = useState<string[]>(["9A1", "9A4"]);
  const [confirming, setConfirming] = useState(false);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === ROWS.length;

  return (
    <Page>
      <PageHeader
        title="死信 / 重试"
        subtitle="按消费者组查看 · %RETRY% 与 %DLQ% 队列"
        actions={<Btn>导出全部</Btn>}
      />
      <Toolbar>
        <SelectField value="组：order-settle" />
        <Seg options={VIEWS} value={view} onChange={setView} />
        <SelectField value="近 24 小时" />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">查询</Btn>
      </Toolbar>

      <ListPane>
        <Table>
          <THead>
            <TR>
              <TH style={{ width: "28px" }}>
                <Check
                  checked={allChecked}
                  label="全选"
                  onChange={() => setChecked(allChecked ? [] : ROWS.map((r) => r.id))}
                />
              </TH>
              <TH>MsgId</TH>
              <TH>原 Topic</TH>
              <TH>Key</TH>
              <TH style={R}>重试</TH>
              <TH>最后失败原因</TH>
              <TH>进入死信时间</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const on = checked.includes(row.id);
              const dim = on ? undefined : "#666";
              return (
                <TR key={row.id} selected={on}>
                  <TD>
                    <Check checked={on} label={row.msgId} onChange={() => toggle(row.id)} />
                  </TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.msgId}</TD>
                  <TD className="mono3" style={DIM11}>{row.topic}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.key}</TD>
                  <TD className="mono3" style={{ ...R, color: dim }}>{row.retries}</TD>
                  <TD style={{ color: on ? "#b91c1c" : "#8a8a8a", maxWidth: "200px" }}>{row.reason}</TD>
                  <TD className="mono3" style={{ ...MONO11, color: dim }}>{row.at}</TD>
                </TR>
              );
            })}
            <SkeletonRows colSpan={7} widths={["68%", "54%"]} />
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint="重投以新 MsgId 写入，原消息保留">
        <span>已选 {checked.length} 条</span>
        <Btn variant="primary" onClick={() => setConfirming(true)}>
          重投到原 Topic
        </Btn>
        <Btn>导出</Btn>
        <Btn variant="danger">删除</Btn>
      </BulkBar>

      {confirming && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(23,23,23,.32)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 6,
          }}
          onClick={() => setConfirming(false)}
        >
          <Card
            role="alertdialog"
            aria-label="重投死信消息"
            style={{ width: "420px", boxShadow: "0 18px 50px rgba(0,0,0,.22)", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px 4px" }}>
              <b style={{ fontSize: "13.5px" }}>重投 {checked.length} 条死信消息？</b>
            </div>
            <div
              style={{
                padding: "8px 20px 16px",
                fontSize: "12px",
                color: "#525252",
                lineHeight: 1.7,
              }}
            >
              将以<b>新 MsgId</b> 重新写入{" "}
              <span className="mono3" style={MONO11}>ORDER_CREATE</span>，由{" "}
              <span className="mono3" style={MONO11}>order-settle</span>{" "}
              正常消费；原消息保留在死信队列，可稍后删除。
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                padding: "12px 20px",
                borderTop: "1px solid #ebebeb",
                background: "#fcfcfc",
              }}
            >
              <span style={{ fontSize: "11px", color: "#8a8a8a", alignSelf: "center" }}>
                高危操作 · 记录到操作日志
              </span>
              <span style={{ flex: 1 }} />
              <Btn onClick={() => setConfirming(false)}>取消</Btn>
              <Btn variant="primary" onClick={() => setConfirming(false)}>
                确认重投
              </Btn>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
