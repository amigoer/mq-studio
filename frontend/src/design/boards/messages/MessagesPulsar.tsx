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
  { value: "peek", label: "Peek 最新" },
  { value: "msgid", label: "按 MessageId" },
  { value: "time", label: "按发布时间" },
] as const;

const SHEET_TABS = ["消息", "属性"] as const;
const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "#666" } as const;
const R = { textAlign: "right" } as const;

/** Board 13c — Pulsar. Peeking by subscription never moves the cursor. */
export function MessagesPulsar() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("peek");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("消息");

  return (
    <Page>
      <PageHeader title="消息查询" subtitle="" />
      <Toolbar>
        <SelectField value="Topic：…/order-created" />
        <SelectField value="订阅：settle-sub" />
        <Seg options={MODES} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 70px" }} defaultValue="50" />
        <Btn variant="primary">查询</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH>MessageId</TH>
                <TH>Key</TH>
                <TH>摘要</TH>
                <TH style={R}>属性</TH>
                <TH>发布时间</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "812:4:0"} onClick={() => setSelected("812:4:0")}>
                <TD className="mono3" style={MONO11}>812:4:0</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88213"…'}</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
              </TR>
              <TR selected={selected === "812:5:0"} onClick={() => setSelected("812:5:0")}>
                <TD className="mono3" style={MONO11}>812:5:0</TD>
                <TD className="mono3" style={MONO11}>ORD-88214</TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88214"…'}</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={MONO11}>10:24:07.310</TD>
              </TR>
              <TR selected={selected === "812:6:1"} onClick={() => setSelected("812:6:1")}>
                <TD className="mono3" style={MONO11}>812:6:1</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#8a8a8a" }}>—</TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88215"…'}</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD className="mono3" style={MONO11}>10:24:08.004</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["66%", "50%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>ledger:entry</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <KV
                rows={[
                  ["MessageId", <span className="mono3" style={MONO11}>ledger 812 · entry 4 · batch 0</span>],
                  ["Producer", <span className="mono3" style={MONO11}>order-svc-producer-2</span>],
                  ["发布 / 事件时间", <span className="mono3" style={MONO11}>10:24:07.221 / 10:24:07.001</span>],
                  ["Schema", <span className="mono3" style={MONO11}>JSON v3</span>],
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
                <SectionLabel style={{ marginBottom: "6px" }}>Properties（4）</SectionLabel>
                <KV
                  rows={[
                    ["traceId", <span className="mono3" style={MONO11}>t-9f21</span>],
                    ["env", <span className="mono3" style={MONO11}>prod</span>],
                  ]}
                />
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>复制</Btn>
              <Btn>Seek 到此消息…</Btn>
              <span style={{ flex: 1 }} />
              <Btn>导出</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid #ebebeb", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "#8a8a8a" }}>
          peek 不影响订阅游标 · markDeletePosition 812:2:0
        </span>
        <span style={{ flex: 1 }} />
      </Toolbar>
    </Page>
  );
}
