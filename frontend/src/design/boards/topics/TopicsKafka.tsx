import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  MiniTable,
  ProtoBadge,
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

const SHEET_TABS = ["概览", "分区", "消费者", "配置"] as const;

/** Board 4c — Kafka topics. Same skeleton as 3c; queues become partitions. */
export function TopicsKafka() {
  const [showInternal, setShowInternal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("分区");

  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle="42 个 · 内部 Topic 已隐藏"
        actions={<Btn variant="primary">+ 新建 Topic</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 240px" }} placeholder="搜索 Topic 名称…" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showInternal} onCheckedChange={setShowInternal} label="显示内部 Topic" />
          显示内部 Topic
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
                <TH style={{ textAlign: "right" }}>分区</TH>
                <TH style={{ textAlign: "right" }}>副本</TH>
                <TH style={{ textAlign: "right" }}>生产速率</TH>
                <TH style={{ textAlign: "right" }}>堆积</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "orders.created"} onClick={() => setSelected("orders.created")}>
                <TD>
                  <b style={{ fontWeight: 500 }}>orders.created</b>{" "}
                  <Status tone="warn" style={{ fontSize: "10px" }}>URP</Status>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>24</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104/s</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>9 820</TD>
              </TR>
              <TR selected={selected === "payments.captured"} onClick={() => setSelected("payments.captured")}>
                <TD>payments.captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>12</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880/s</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>840</TD>
              </TR>
              <TR selected={selected === "user.signup"} onClick={() => setSelected("user.signup")}>
                <TD>user.signup</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>6</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>45/s</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["76%", "58%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<ProtoBadge protocol="kafka" />}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody style={{ gap: "10px" }}>
              <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "var(--c-muted)" }}>
                <span>24 分区 · 副本因子 3</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: "var(--c-warn-text)" }}>1 个分区未完全同步</span>
              </div>
              <Card style={{ overflow: "hidden" }}>
                <MiniTable>
                  <THead>
                    <TR>
                      <TH style={{ textAlign: "right" }}>P</TH>
                      <TH style={{ textAlign: "right" }}>Leader</TH>
                      <TH>ISR</TH>
                      <TH style={{ textAlign: "right" }}>结束位点</TH>
                    </TR>
                  </THead>
                  <TBody>
                    <TR>
                      <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                      <TD className="mono3">1,2,3</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>88 204 771</TD>
                    </TR>
                    <TR>
                      <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                      <TD className="mono3">2,3,1</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>88 198 042</TD>
                    </TR>
                    <TR style={{ background: "var(--c-warn-bg-soft)" }}>
                      <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                      <TD className="mono3" style={{ color: "var(--c-warn-text)" }}>
                        3,1 <span style={{ fontSize: "9.5px" }}>(缺 2)</span>
                      </TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>88 201 118</TD>
                    </TR>
                    <TR>
                      <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                      <TD className="mono3">1,3,2</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>88 197 664</TD>
                    </TR>
                    <TR>
                      <TD colSpan={4} style={{ padding: "6px 10px", color: "var(--c-muted)", fontSize: "10.5px" }}>
                        … 其余 20 个分区
                      </TD>
                    </TR>
                  </TBody>
                </MiniTable>
              </Card>
            </SheetBody>
            <SheetFooter>
              <Btn>查看消息</Btn>
              <Btn>增加分区</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">删除</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
