import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
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

const SHEET_TABS = ["概览", "分区", "订阅", "策略"] as const;
const NAME = { fontSize: "11.5px" } as const;

/** Board 12a — Pulsar topics, scoped by a tenant / namespace cascade. */
export function TopicsPulsar() {
  const [persistentOnly, setPersistentOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("概览");

  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle="租户 ecommerce · 命名空间 orders · 18 个 Topic"
        actions={<Btn variant="primary">+ 新建 Topic</Btn>}
      />
      <Toolbar>
        <SelectField value="租户：ecommerce" />
        <SelectField value="命名空间：orders" />
        <Field style={{ flex: "0 0 180px" }} placeholder="搜索 Topic…" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={persistentOnly} onCheckedChange={setPersistentOnly} label="仅 persistent" />
          仅 persistent
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value="按积压排序" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>分区</TH>
                <TH style={{ textAlign: "right" }}>生产者</TH>
                <TH style={{ textAlign: "right" }}>订阅</TH>
                <TH style={{ textAlign: "right" }}>入速率</TH>
                <TH style={{ textAlign: "right" }}>积压</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "order-created"} onClick={() => setSelected("order-created")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                    persistent://ecommerce/orders/order-created
                  </b>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104/s</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>6 591</TD>
              </TR>
              <TR selected={selected === "payment-captured"} onClick={() => setSelected("payment-captured")}>
                <TD className="mono3" style={NAME}>persistent://ecommerce/orders/payment-captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880/s</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 830</TD>
              </TR>
              <TR selected={selected === "metrics-tick"} onClick={() => setSelected("metrics-tick")}>
                <TD className="mono3" style={{ ...NAME, color: "var(--c-muted)" }}>
                  non-persistent://ecommerce/orders/metrics-tick
                </TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>2 400/s</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>—</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["70%", "52%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>8 分区</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>入 / 出</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 104 / 2 987
                  </div>
                </Card>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>存储大小</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    18.2 GB
                  </div>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>策略（命名空间继承 · 可覆盖）</SectionLabel>
                <KV
                  rows={[
                    ["消息 TTL", "7 天"],
                    ["保留", "大小 50GB / 时间 30 天"],
                    ["积压配额", "10GB · 超限 producer_exception"],
                    ["Schema", "JSON · 兼容 BACKWARD"],
                  ]}
                />
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>订阅</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="warn">settle-sub · 6 210</Status>
                  <Status tone="ok">notify-sub</Status>
                  <Status tone="ok">audit-sub</Status>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>查看消息</Btn>
              <Btn>卸载 unload</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">删除</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
