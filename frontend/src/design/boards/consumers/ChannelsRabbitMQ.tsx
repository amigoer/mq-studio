import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
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

const SHEET_TABS = ["信道", "属性"] as const;
const R = { textAlign: "right" } as const;
const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 14e — RabbitMQ has no consumer groups, so the slot becomes the
 * connection → channel → consumer tree. prefetch vs unacked locates a stall.
 */
export function ChannelsRabbitMQ() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("信道");

  return (
    <Page>
      <PageHeader title="连接 / 信道" subtitle="vhost /order · 连接 128 · 信道 342" />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder="搜索连接 / 用户…" />
        <span style={{ flex: 1 }} />
        <SelectField value="按 unacked 排序" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH>连接</TH>
                <TH>用户</TH>
                <TH style={R}>信道</TH>
                <TH>状态</TH>
                <TH style={R}>收 / 发速率</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "10.2.3.4:52210"} onClick={() => setSelected("10.2.3.4:52210")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>10.2.3.4:52210</b>
                </TD>
                <TD>settle-svc</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD><Status tone="warn">flow</Status></TD>
                <TD className="mono3" style={R}>1 104 / 0 msg/s</TD>
              </TR>
              <TR selected={selected === "10.2.3.5:52344"} onClick={() => setSelected("10.2.3.5:52344")}>
                <TD className="mono3" style={NAME}>10.2.3.5:52344</TD>
                <TD>settle-svc</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD><Status tone="ok">running</Status></TD>
                <TD className="mono3" style={R}>998 / 0</TD>
              </TR>
              <TR selected={selected === "10.2.4.1:41022"} onClick={() => setSelected("10.2.4.1:41022")}>
                <TD className="mono3" style={NAME}>10.2.4.1:41022</TD>
                <TD>order-svc</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD><Status tone="ok">running</Status></TD>
                <TD className="mono3" style={R}>0 / 2 980</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["60%", "44%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="warn" style={{ fontSize: "10px" }}>flow</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>信道（4）</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH style={R}>#</TH>
                        <TH>consumer tag</TH>
                        <TH style={R}>prefetch</TH>
                        <TH style={R}>unacked</TH>
                        <TH style={R}>ack/s</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3" style={R}>1</TD>
                        <TD className="mono3">ctag-settle-1</TD>
                        <TD className="mono3" style={R}>50</TD>
                        <TD className="mono3" style={{ ...R, color: "#b45309" }}>50</TD>
                        <TD className="mono3" style={{ ...R, color: "#b45309" }}>0</TD>
                      </TR>
                      <TR>
                        <TD className="mono3" style={R}>2</TD>
                        <TD className="mono3">ctag-settle-2</TD>
                        <TD className="mono3" style={R}>50</TD>
                        <TD className="mono3" style={R}>12</TD>
                        <TD className="mono3" style={R}>280</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ fontSize: "11px", color: "#b45309" }}>
                ctag-settle-1 prefetch 打满且 ack=0 → 消费卡死，建议检查该进程
              </div>

              <KV
                rows={[
                  ["客户端", <span className="mono3" style={MONO11}>java-amqp-client 5.20</span>],
                  ["心跳", "60s"],
                  ["TLS", "TLSv1.3"],
                ]}
              />
            </SheetBody>
            <SheetFooter>
              <Btn>查看队列</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">关闭连接</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
