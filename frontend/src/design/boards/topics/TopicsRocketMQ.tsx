import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  ProtoBadge,
  SectionLabel,
  SelectField,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Status,
  Sw,
  MiniTable,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const SHEET_TABS = ["概览", "队列", "路由", "订阅", "配置"] as const;

/**
 * Board 3c — RocketMQ topics. The detail panel is a floating sheet rather than
 * a third column, so opening it never reflows the table's column widths.
 */
export function TopicsRocketMQ() {
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("概览");

  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle="128 个 · 系统 Topic 已隐藏"
        actions={<Btn variant="primary">+ 新建 Topic</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 240px" }} placeholder="搜索 Topic 名称…" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showSystem} onCheckedChange={setShowSystem} label="显示系统 Topic" />
          显示系统 Topic
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value="按堆积排序" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>队列 读/写</TH>
                <TH style={{ textAlign: "right" }}>生产 TPS</TH>
                <TH style={{ textAlign: "right" }}>今日消息量</TH>
                <TH style={{ textAlign: "right" }}>堆积</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "ORDER_CREATE"} onClick={() => setSelected("ORDER_CREATE")}>
                <TD>
                  <b style={{ fontWeight: 500 }}>ORDER_CREATE</b>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>16 / 16</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8.2M</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TD>
              </TR>
              <TR selected={selected === "ORDER_PAY_DELAY"} onClick={() => setSelected("ORDER_PAY_DELAY")}>
                <TD>ORDER_PAY_DELAY</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8 / 8</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>320</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2.1M</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <TR selected={selected === "USER_REGISTER"} onClick={() => setSelected("USER_REGISTER")}>
                <TD>USER_REGISTER</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8 / 8</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>45</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>380K</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <TR selected={selected === "%RETRY%order-settle"} onClick={() => setSelected("%RETRY%order-settle")}>
                <TD style={{ color: "var(--c-muted)" }}>%RETRY%order-settle</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1 / 1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>12</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>9.4K</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>37</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["72%", "58%", "80%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<ProtoBadge protocol="rocketmq" label="RMQ 5.x" />}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>生产 TPS</div>
                  <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px" }}>
                    1 104
                  </div>
                </Card>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>堆积</div>
                  <div
                    className="mono3"
                    style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px", color: "var(--c-warn-text)" }}
                  >
                    982
                  </div>
                </Card>
              </div>

              <KV
                rows={[
                  ["权限", "读写"],
                  ["消息类型", "普通（5.x NORMAL）"],
                  ["创建时间", <span className="mono3" style={{ fontSize: "11px" }}>2026-03-14 11:02</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>队列分布</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>Broker</TH>
                        <TH style={{ textAlign: "right" }}>队列</TH>
                        <TH style={{ textAlign: "right" }}>最大位点</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3">broker-a</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>q0–q7</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>1 204 771</TD>
                      </TR>
                      <TR>
                        <TD className="mono3">broker-b</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>q8–q15</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>1 198 042</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>订阅组</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="warn">order-settle · 堆积</Status>
                  <Status tone="ok">order-notify</Status>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>查看消息</Btn>
              <Btn>发送消息</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">删除</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
