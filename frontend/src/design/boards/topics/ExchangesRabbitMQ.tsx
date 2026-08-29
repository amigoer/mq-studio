import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  MiniTable,
  SectionLabel,
  Seg,
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

const SHEET_TABS = ["绑定", "概览", "参数"] as const;
const TAG = { fontSize: "10px" } as const;
const NAME = { fontSize: "11.5px" } as const;

const TYPES = [
  { value: "all", label: "全部" },
  { value: "topic", label: "topic" },
  { value: "direct", label: "direct" },
  { value: "fanout", label: "fanout" },
  { value: "headers", label: "headers" },
] as const;

const BINDINGS = [
  { target: "order.settle.q", key: "order.created" },
  { target: "order.settle.q", key: "order.updated" },
  { target: "order.notify.q", key: "order.#" },
  { target: "audit.pipeline.q", key: "#" },
];

/** Board 12c — RabbitMQ exchanges. AMQP-only page; the sheet is the binding list. */
export function ExchangesRabbitMQ() {
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("all");
  const [showAmq, setShowAmq] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("绑定");

  return (
    <Page>
      <PageHeader
        title="交换机"
        subtitle="vhost /order · 14 个（隐藏 amq.* 默认交换机）"
        actions={<Btn variant="primary">+ 新建交换机</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 200px" }} placeholder="搜索交换机…" />
        <Seg options={TYPES} value={type} onChange={setType} />
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showAmq} onCheckedChange={setShowAmq} label="显示 amq.*" />
          显示 amq.*
        </span>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>交换机</TH>
                <TH>类型</TH>
                <TH>特性</TH>
                <TH style={{ textAlign: "right" }}>绑定</TH>
                <TH style={{ textAlign: "right" }}>入速率</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "ex.order"} onClick={() => setSelected("ex.order")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>ex.order</b>
                </TD>
                <TD>topic</TD>
                <TD><Status tone="off" style={TAG}>durable</Status></TD>
                <TD className="mono3" style={{ textAlign: "right" }}>6</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 980/s</TD>
              </TR>
              <TR selected={selected === "ex.notify"} onClick={() => setSelected("ex.notify")}>
                <TD className="mono3" style={NAME}>ex.notify</TD>
                <TD>fanout</TD>
                <TD><Status tone="off" style={TAG}>durable</Status></TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003/s</TD>
              </TR>
              <TR selected={selected === "dlx.order"} onClick={() => setSelected("dlx.order")}>
                <TD className="mono3" style={NAME}>dlx.order</TD>
                <TD>direct</TD>
                <TD>
                  <Status tone="off" style={TAG}>durable</Status>{" "}
                  <Status tone="err" style={TAG}>DLX</Status>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0.2/s</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["58%", "44%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={TAG}>topic</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>绑定（6）</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>目标</TH>
                        <TH>routing key</TH>
                        <TH style={{ textAlign: "right" }} />
                      </TR>
                    </THead>
                    <TBody>
                      {BINDINGS.map((b) => (
                        <TR key={`${b.target}-${b.key}`}>
                          <TD className="mono3">{b.target}</TD>
                          <TD className="mono3">{b.key}</TD>
                          <TD style={{ textAlign: "right", color: "var(--c-muted)" }}>解绑</TD>
                        </TR>
                      ))}
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>新增绑定</SectionLabel>
                <div style={{ display: "flex", gap: "8px" }}>
                  <SelectField style={{ flex: 1 }} value="队列" />
                  <Field className="mono3" style={{ flex: 1, fontSize: "11px" }} placeholder="routing key" />
                  <Btn>绑定</Btn>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>发布测试消息</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">删除</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
