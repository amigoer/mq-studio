import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
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

const SHEET_TABS = ["分区分配", "成员", "位点"] as const;
const R = { textAlign: "right" } as const;

/** Board 14a — Kafka consumer groups; Rebalancing is a first-class state. */
export function ConsumersKafka() {
  const [lagOnly, setLagOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("分区分配");

  return (
    <Page>
      <PageHeader title="消费者组" subtitle="18 个 · 1 再均衡中" />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder="搜索消费者组…" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#666" }}>
          <Sw checked={lagOnly} onCheckedChange={setLagOnly} label="仅看有 lag" />
          仅看有 lag
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value="按 lag 排序" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH>Group</TH>
                <TH>状态</TH>
                <TH style={R}>成员</TH>
                <TH style={R}>Topic</TH>
                <TH style={R}>总 lag</TH>
                <TH style={R}>消费速率</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "settle-consumer"} onClick={() => setSelected("settle-consumer")}>
                <TD><b style={{ fontWeight: 500 }}>settle-consumer</b></TD>
                <TD><Status tone="ok">Stable</Status></TD>
                <TD className="mono3" style={R}>6</TD>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={{ ...R, color: "#b45309" }}>9 820</TD>
                <TD className="mono3" style={R}>1 104/s</TD>
              </TR>
              <TR selected={selected === "notify-consumer"} onClick={() => setSelected("notify-consumer")}>
                <TD>notify-consumer</TD>
                <TD><Status tone="ok">Stable</Status></TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={R}>1 220</TD>
                <TD className="mono3" style={R}>2 003/s</TD>
              </TR>
              <TR selected={selected === "audit-pipeline"} onClick={() => setSelected("audit-pipeline")}>
                <TD>audit-pipeline</TD>
                <TD><Status tone="warn">Rebalancing</Status></TD>
                <TD className="mono3" style={R}>3→4</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD className="mono3" style={R}>840</TD>
                <TD className="mono3" style={R}>—</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["66%", "50%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="ok" style={{ fontSize: "10px" }}>Stable</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <MiniStat label="总 lag" value="9 820" color="#b45309" size={15} />
                <MiniStat label="成员" value="6" size={15} />
                <MiniStat label="分配策略" value="range" size={15} />
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>分区 lag（orders.created）</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH style={R}>P</TH>
                        <TH>member</TH>
                        <TH style={R}>committed</TH>
                        <TH style={R}>end</TH>
                        <TH style={R}>lag</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3" style={R}>0</TD>
                        <TD className="mono3">c-1@10.2.3.4</TD>
                        <TD className="mono3" style={R}>88 199 021</TD>
                        <TD className="mono3" style={R}>88 204 771</TD>
                        <TD className="mono3" style={{ ...R, color: "#b45309" }}>5 750</TD>
                      </TR>
                      <TR>
                        <TD className="mono3" style={R}>1</TD>
                        <TD className="mono3">c-1@10.2.3.4</TD>
                        <TD className="mono3" style={R}>88 201 990</TD>
                        <TD className="mono3" style={R}>88 204 018</TD>
                        <TD className="mono3" style={R}>2 028</TD>
                      </TR>
                      <TR>
                        <TD className="mono3" style={R}>2</TD>
                        <TD className="mono3">c-2@10.2.3.5</TD>
                        <TD className="mono3" style={R}>88 202 771</TD>
                        <TD className="mono3" style={R}>88 204 813</TD>
                        <TD className="mono3" style={R}>2 042</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ fontSize: "11px", color: "#8a8a8a" }}>lag 集中在 c-1 的 p0 · 建议检查该实例</div>
            </SheetBody>
            <SheetFooter>
              <Btn>重置位点…</Btn>
              <Btn>导出 lag</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">删除组</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
