import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Field,
  IND,
  JNum,
  JsonBlock,
  JStr,
  KV,
  SectionLabel,
  Seg,
  SelectField,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const MODES = [
  { value: "latest", label: "最新 N 条" },
  { value: "offset", label: "按 Offset" },
  { value: "time", label: "按时间" },
  { value: "key", label: "按 Key" },
] as const;

const SHEET_TABS = ["消息", "Headers"] as const;
const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

/** Board 13a — Kafka messages: partition + offset / timestamp / key, no trace. */
export function MessagesKafka() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("latest");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("消息");

  return (
    <Page>
      <PageHeader title="消息查询" subtitle="" />
      <Toolbar>
        <SelectField value="Topic：orders.created" />
        <SelectField value="分区 ALL" />
        <Seg options={MODES} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 90px" }} defaultValue="500" />
        <Btn variant="primary">查询</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH style={R}>分区</TH>
                <TH style={R}>Offset</TH>
                <TH>Key</TH>
                <TH>Value 摘要</TH>
                <TH style={R}>Headers</TH>
                <TH>时间戳</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "88 204 771"} onClick={() => setSelected("88 204 771")}>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={R}>88 204 771</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#666" }}>
                  {'{"orderId":"ORD-88213","amount":129…'}
                </TD>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
              </TR>
              <TR selected={selected === "88 204 772"} onClick={() => setSelected("88 204 772")}>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={R}>88 204 772</TD>
                <TD className="mono3" style={MONO11}>ORD-88214</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#666" }}>
                  {'{"orderId":"ORD-88214","amount":45…'}
                </TD>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={MONO11}>10:24:07.310</TD>
              </TR>
              <TR selected={selected === "88 204 773"} onClick={() => setSelected("88 204 773")}>
                <TD className="mono3" style={R}>0</TD>
                <TD className="mono3" style={R}>88 204 773</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#8a8a8a" }}>null</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#666" }}>
                  {'{"orderId":"ORD-88215","amount":268…'}
                </TD>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={MONO11}>10:24:08.004</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["74%", "58%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={`offset ${selected}`}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>p3</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <KV
                rows={[
                  ["分区 / Offset", <span className="mono3" style={MONO11}>3 / 88 204 771</span>],
                  ["Key", <span className="mono3" style={MONO11}>ORD-88213（String）</span>],
                  ["时间戳", <span className="mono3" style={MONO11}>10:24:07.221 · CreateTime</span>],
                  ["大小", <span className="mono3" style={MONO11}>1.2 KB · lz4</span>],
                ]}
              />

              <div>
                <SectionLabel
                  style={{ marginBottom: "6px" }}
                  action="反序列化：JSON ▾"
                  actionColor="#525252"
                >
                  Value · JSON
                </SectionLabel>
                <JsonBlock>
                  {"{"}
                  <br />
                  {IND}"orderId": <JStr>"ORD-88213"</JStr>,
                  <br />
                  {IND}"amount": <JNum>129.00</JNum>,
                  <br />
                  {IND}"status": <JStr>"CREATED"</JStr>
                  <br />
                  {"}"}
                </JsonBlock>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Headers（3）</SectionLabel>
                <KV
                  rows={[
                    ["traceId", <span className="mono3" style={MONO11}>t-9f21</span>],
                    ["source", <span className="mono3" style={MONO11}>order-svc</span>],
                    ["schemaId", <span className="mono3" style={MONO11}>42</span>],
                  ]}
                />
              </div>

              <div style={{ fontSize: "11px", color: "#8a8a8a" }}>
                Kafka 无消费轨迹 · 各组消费进度见「消费者组」页
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>复制</Btn>
              <Btn>重发到 Topic…</Btn>
              <span style={{ flex: 1 }} />
              <Btn>导出</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid #ebebeb", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "#8a8a8a" }}>
          游标：p3 从 88 204 271 起 · 已读 500 条
        </span>
        <span style={{ flex: 1 }} />
        <Btn>加载更早 ‹</Btn>
        <Btn>› 加载更新</Btn>
      </Toolbar>
    </Page>
  );
}
