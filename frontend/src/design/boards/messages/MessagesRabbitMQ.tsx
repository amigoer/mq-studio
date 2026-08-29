import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
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
  WarnBanner,
} from "@/design/ui";

const MODES = [
  { value: "requeue", label: "requeue（安全）" },
  { value: "ack", label: "ack（移除）" },
] as const;

const SHEET_TABS = ["Payload", "Properties"] as const;
const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const TAG = { fontSize: "10px" } as const;
const R = { textAlign: "right" } as const;

/**
 * Board 13b — RabbitMQ can only browse the queue head (basic.get), so the page
 * defaults to requeue and keeps the warning banner permanently visible.
 */
export function MessagesRabbitMQ() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("requeue");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("Payload");

  return (
    <Page>
      <PageHeader title="浏览队列消息" subtitle="AMQP 仅支持取队头 · requeue 模式不破坏队列" />
      <WarnBanner>
          <TriangleAlert size={13} style={{ flex: "none" }} aria-hidden />
          ack 模式会把消息从队列移除且无法恢复；生产环境请使用 requeue 模式
        </WarnBanner>
      <Toolbar>
        <SelectField value="队列：order.settle.q" />
        <Field className="mono3" style={{ flex: "0 0 70px" }} defaultValue="10 条" />
        <Seg options={MODES} value={mode} onChange={setMode} />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">获取</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH style={R}>#</TH>
                <TH>routing key</TH>
                <TH>exchange</TH>
                <TH>属性</TH>
                <TH>payload 摘要</TH>
                <TH>重投递</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "1"} onClick={() => setSelected("1")}>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={MONO11}>order.created</TD>
                <TD className="mono3" style={DIM11}>ex.order</TD>
                <TD><Status tone="off" style={TAG}>persistent</Status></TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88213"…'}</TD>
                <TD><Status tone="warn" style={TAG}>redelivered</Status></TD>
              </TR>
              <TR selected={selected === "2"} onClick={() => setSelected("2")}>
                <TD className="mono3" style={R}>2</TD>
                <TD className="mono3" style={MONO11}>order.created</TD>
                <TD className="mono3" style={DIM11}>ex.order</TD>
                <TD><Status tone="off" style={TAG}>persistent</Status></TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88214"…'}</TD>
                <TD />
              </TR>
              <TR selected={selected === "3"} onClick={() => setSelected("3")}>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={MONO11}>order.updated</TD>
                <TD className="mono3" style={DIM11}>ex.order</TD>
                <TD><Status tone="off" style={TAG}>TTL 30s</Status></TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88101"…'}</TD>
                <TD />
              </TR>
              <SkeletonRows colSpan={6} widths={["60%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={`#${selected} · order.created`}
              badge={<Status tone="warn" style={TAG}>redelivered</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel
                  style={{ marginBottom: "6px" }}
                  action={
            <>
              反序列化：JSON
              <ChevronDown size={12} aria-hidden />
            </>
          }
                  actionColor="var(--c-fg-2)"
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
                <SectionLabel style={{ marginBottom: "6px" }}>Properties</SectionLabel>
                <KV
                  rows={[
                    ["content_type", <span className="mono3" style={MONO11}>application/json</span>],
                    ["delivery_mode", "2 · persistent"],
                    ["expiration", <span className="mono3" style={MONO11}>30000</span>],
                    ["headers", <span className="mono3" style={MONO11}>x-retry=2 · traceId=t-9f21</span>],
                  ]}
                />
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                x-death：order.settle.q · rejected ×2 · 最后 10:02:37
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>复制</Btn>
              <Btn>重新发布…</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">ack 移除</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          已取 10 / Ready 982 · 消息已 requeue 回队列
        </span>
        <span style={{ flex: 1 }} />
      </Toolbar>
    </Page>
  );
}
