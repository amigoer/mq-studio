import { useState } from "react";
import { ArrowRight, Copy, X } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Field,
  IND,
  JDim,
  JNum,
  JsonBlock,
  JStr,
  KV,
  ProtoBadge,
  SectionLabel,
  Seg,
  SelectField,
  Sheet,
  SheetBody,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Timeline,
  TR,
} from "@/design/ui";

const MODES = [
  { value: "key", label: "按 Key" },
  { value: "msgid", label: "按 MsgId" },
  { value: "time", label: "按时间" },
] as const;

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

/** Board 3d — RocketMQ message search. The consumption trace is RocketMQ-only. */
export function MessagesRocketMQ() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("key");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader title="消息查询" />
      <Toolbar>
        <SelectField value="Topic：ORDER_CREATE" />
        <Seg options={MODES} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 180px" }} defaultValue="ORD-88213" />
        <SelectField value="近 6 小时" />
        <Btn variant="primary">查询</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>MsgId</TH>
                <TH>Key</TH>
                <TH>Tag</TH>
                <TH style={R}>队列</TH>
                <TH>存储时间</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              <TR
                selected={selected === "7F0000012A9C…4C1"}
                onClick={() => setSelected("7F0000012A9C…4C1")}
              >
                <TD className="mono3" style={MONO11}>7F0000012A9C…4C1</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD>create</TD>
                <TD className="mono3" style={R}>a/q3</TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
                <TD><Status tone="warn">重试中</Status></TD>
              </TR>
              <TR selected={selected === "7F0000012A9C…4C2"} onClick={() => setSelected("7F0000012A9C…4C2")}>
                <TD className="mono3" style={{ ...MONO11, color: "#666" }}>7F0000012A9C…4C2</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD>paid</TD>
                <TD className="mono3" style={R}>a/q1</TD>
                <TD className="mono3" style={MONO11}>10:24:09.310</TD>
                <TD><Status tone="ok">已消费</Status></TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["76%", "62%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={440} onDismiss={() => setSelected(null)}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 16px",
                borderBottom: "1px solid #ebebeb",
                background: "#fff",
              }}
            >
              <b style={{ fontSize: "13px" }}>消息详情</b>
              <ProtoBadge protocol="rocketmq" label="RMQ 5.x" />
              <span style={{ flex: 1 }} />
              <Btn>重发</Btn>
              <Btn>导出</Btn>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setSelected(null)}
                style={{ display: "flex", color: "#a3a3a3", marginLeft: "2px", background: "none", border: "none", padding: 0 }}
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <SheetBody>
              <KV
                rows={[
                  [
                    "MsgId",
                    <span
                      className="mono3"
                      style={{ ...MONO11, display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      7F0000012A9C81E44C1
                      <Copy size={12} color="#29915d" style={{ flex: "none" }} aria-hidden />
                    </span>,
                  ],
                  ["Key / Tag", <span className="mono3" style={MONO11}>ORD-88213 · create</span>],
                  ["位置", <span className="mono3" style={MONO11}>broker-a / q3 / offset 1 204 771</span>],
                  ["Born", <span className="mono3" style={MONO11}>10.12.3.101 · producer-cli-77</span>],
                  ["大小 / 重试", <span className="mono3" style={MONO11}>1.2 KB · reconsume ×2</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }} action="格式化 · 复制">
                  消息体 · JSON
                </SectionLabel>
                <JsonBlock>
                  {"{"}
                  <br />
                  {IND}"orderId": <JStr>"ORD-88213"</JStr>,
                  <br />
                  {IND}"amount": <JNum>129.00</JNum>,
                  <br />
                  {IND}"currency": <JStr>"CNY"</JStr>,
                  <br />
                  {IND}"items": [ <JDim>… 3 项</JDim> ]
                  <br />
                  {"}"}
                </JsonBlock>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
                <SectionLabel style={{ marginBottom: "8px" }}>消费轨迹</SectionLabel>
                <Timeline
                  steps={[
                    { title: "生产成功", meta: "10:24:07.221 · 10.12.3.101" },
                    { title: "Broker 存储", meta: "broker-a q3 · 0.6ms", color: "#a3a3a3" },
                    { title: "order-notify 消费成功", meta: "10:24:07.902 · 681ms" },
                    {
                      title: "order-settle 第 2 次重试",
                      meta: "下次投递 10:26:07",
                      color: "#d97706",
                      extra: (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#29915d" }}>
                          查看重试队列
                          <ArrowRight size={12} aria-hidden />
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </SheetBody>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
