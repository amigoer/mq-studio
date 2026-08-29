import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  MiniStat,
  MiniTable,
  SectionLabel,
  SelectField,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Status,
  Sw,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const SHEET_TABS = ["概览", "成员", "订阅关系", "位点"] as const;
const R = { textAlign: "right" } as const;
const DIM = { textAlign: "right", color: "var(--c-muted)" } as const;

/** Board 9a — RocketMQ consumer groups. */
export function ConsumersRocketMQ() {
  const [backlogOnly, setBacklogOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("概览");

  return (
    <Page>
      <PageHeader title="消费者组" subtitle="32 个 · 2 个堆积告警" />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder="搜索消费者组…" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={backlogOnly} onCheckedChange={setBacklogOnly} label="仅看有堆积" />
          仅看有堆积
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value="按堆积排序" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>组名</TH>
                <TH style={R}>订阅 Topic</TH>
                <TH>模式</TH>
                <TH style={R}>消费 TPS</TH>
                <TH style={R}>堆积</TH>
                <TH style={R}>延迟</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "order-settle"} onClick={() => setSelected("order-settle")}>
                <TD><b style={{ fontWeight: 500 }}>order-settle</b></TD>
                <TD className="mono3" style={R}>1</TD>
                <TD>集群</TD>
                <TD className="mono3" style={R}>1 104</TD>
                <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>982</TD>
                <TD className="mono3" style={R}>2.1s</TD>
                <TD><Status tone="warn">堆积告警</Status></TD>
              </TR>
              <TR selected={selected === "order-notify"} onClick={() => setSelected("order-notify")}>
                <TD>order-notify</TD>
                <TD className="mono3" style={R}>1</TD>
                <TD>集群</TD>
                <TD className="mono3" style={R}>2 003</TD>
                <TD className="mono3" style={R}>120</TD>
                <TD className="mono3" style={R}>0.3s</TD>
                <TD><Status tone="ok">正常</Status></TD>
              </TR>
              <TR selected={selected === "risk-audit"} onClick={() => setSelected("risk-audit")}>
                <TD>risk-audit</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD>集群</TD>
                <TD className="mono3" style={R}>880</TD>
                <TD className="mono3" style={R}>41</TD>
                <TD className="mono3" style={R}>0.1s</TD>
                <TD><Status tone="ok">正常</Status></TD>
              </TR>
              <TR selected={selected === "push-broadcast"} onClick={() => setSelected("push-broadcast")}>
                <TD style={{ color: "var(--c-muted)" }}>push-broadcast</TD>
                <TD className="mono3" style={DIM}>1</TD>
                <TD style={{ color: "var(--c-muted)" }}>广播</TD>
                <TD className="mono3" style={DIM}>45</TD>
                <TD className="mono3" style={DIM}>—</TD>
                <TD className="mono3" style={DIM}>—</TD>
                <TD><Status tone="off">正常</Status></TD>
              </TR>
              <SkeletonRows colSpan={7} widths={["70%", "56%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="warn" style={{ fontSize: "10px" }}>堆积 982</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <MiniStat label="堆积" value="982" color="var(--c-warn-text)" />
                <MiniStat label="消费 TPS" value="1 104" />
                <MiniStat label="客户端" value="4" />
              </div>

              <KV
                rows={[
                  ["订阅", <span className="mono3" style={{ fontSize: "11px" }}>ORDER_CREATE · TAG: create||paid</span>],
                  ["模式", "集群消费 · 并发"],
                  ["重试策略", "最多 16 次 → 死信"],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>在线客户端</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>ClientId</TH>
                        <TH style={R}>分配队列</TH>
                        <TH style={R}>堆积</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3">settle-77@10.2.3.4</TD>
                        <TD className="mono3" style={R}>q0–q7</TD>
                        <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>812</TD>
                      </TR>
                      <TR>
                        <TD className="mono3">settle-78@10.2.3.5</TD>
                        <TD className="mono3" style={R}>q8–q15</TD>
                        <TD className="mono3" style={R}>170</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                堆积集中在 settle-77，建议检查该实例消费耗时
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>重置位点</Btn>
              <Btn>查看死信</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">删除组</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}

