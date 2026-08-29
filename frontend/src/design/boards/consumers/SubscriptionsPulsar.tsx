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
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const SHEET_TABS = ["游标", "Consumer", "配置"] as const;
const R = { textAlign: "right" } as const;
const NAME = { fontSize: "11px", color: "#666" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 14b — Pulsar subscriptions. Cursors move by seek, not by offset reset. */
export function SubscriptionsPulsar() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("游标");

  return (
    <Page>
      <PageHeader title="订阅" subtitle="命名空间 orders · 9 个订阅" />
      <Toolbar>
        <SelectField value="Topic：全部" />
        <Field style={{ flex: "0 0 200px" }} placeholder="搜索订阅…" />
        <span style={{ flex: 1 }} />
        <SelectField value="按积压排序" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH>订阅</TH>
                <TH>Topic</TH>
                <TH>类型</TH>
                <TH style={R}>积压</TH>
                <TH style={R}>未确认</TH>
                <TH style={R}>出速率</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "settle-sub"} onClick={() => setSelected("settle-sub")}>
                <TD><b style={{ fontWeight: 500 }}>settle-sub</b></TD>
                <TD className="mono3" style={NAME}>…/order-created</TD>
                <TD>Shared</TD>
                <TD className="mono3" style={{ ...R, color: "#b45309" }}>6 210</TD>
                <TD className="mono3" style={R}>48</TD>
                <TD className="mono3" style={R}>1 104/s</TD>
              </TR>
              <TR selected={selected === "notify-sub"} onClick={() => setSelected("notify-sub")}>
                <TD>notify-sub</TD>
                <TD className="mono3" style={NAME}>…/order-created</TD>
                <TD>Key_Shared</TD>
                <TD className="mono3" style={R}>381</TD>
                <TD className="mono3" style={R}>6</TD>
                <TD className="mono3" style={R}>2 003/s</TD>
              </TR>
              <TR selected={selected === "audit-sub"} onClick={() => setSelected("audit-sub")}>
                <TD>audit-sub</TD>
                <TD className="mono3" style={NAME}>…/payment-captured</TD>
                <TD>Failover</TD>
                <TD className="mono3" style={R}>1 830</TD>
                <TD className="mono3" style={R}>0</TD>
                <TD className="mono3" style={R}>880/s</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["62%", "46%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>Shared</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <MiniStat label="积压" value="6 210" color="#b45309" size={15} />
                <MiniStat label="未确认" value="48" size={15} />
              </div>

              <KV
                rows={[
                  ["markDelete", <span className="mono3" style={MONO11}>812:2:0</span>],
                  ["readPosition", <span className="mono3" style={MONO11}>812:6:1</span>],
                  ["最早未确认", <span className="mono3" style={MONO11}>10:02:37（22 分钟前）</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Consumer（4）</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>name</TH>
                        <TH>addr</TH>
                        <TH style={R}>未确认</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3">settle-1</TD>
                        <TD className="mono3">10.2.3.4</TD>
                        <TD className="mono3" style={{ ...R, color: "#b45309" }}>41</TD>
                      </TR>
                      <TR>
                        <TD className="mono3">settle-2</TD>
                        <TD className="mono3">10.2.3.5</TD>
                        <TD className="mono3" style={R}>7</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <Btn>Seek 时间…</Btn>
                <Btn>Seek MessageId…</Btn>
                <Btn>跳过 N 条…</Btn>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn variant="danger">清空积压</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">解除订阅</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
