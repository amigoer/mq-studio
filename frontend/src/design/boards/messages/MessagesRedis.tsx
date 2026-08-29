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
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const MODES = [
  { value: "latest", label: "最新 N 条" },
  { value: "range", label: "按 ID 范围" },
  { value: "time", label: "按时间" },
] as const;

const SHEET_TABS = ["字段", "消费状态"] as const;
const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "#666" } as const;
const R = { textAlign: "right" } as const;

const FIELDS = [
  ["orderId", "ORD-88213"],
  ["amount", "129.00"],
  ["currency", "CNY"],
  ["status", "CREATED"],
  ["ts", "1756454646"],
] as const;

/** Board 13d — Redis Stream. Entries are field/value pairs, not a JSON body. */
export function MessagesRedis() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("latest");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("字段");

  return (
    <Page>
      <PageHeader title="消息查询" subtitle="" />
      <Toolbar>
        <SelectField value="Stream：orders:events" />
        <Seg options={MODES} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 150px" }} defaultValue="- ～ +" />
        <Field className="mono3" style={{ flex: "0 0 70px" }} defaultValue="100" />
        <Btn variant="primary">查询</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH>Entry ID</TH>
                <TH style={R}>字段数</TH>
                <TH>字段摘要</TH>
                <TH>时间</TH>
              </TR>
            </THead>
            <TBody>
              <TR
                selected={selected === "1756454646018-0"}
                onClick={() => setSelected("1756454646018-0")}
              >
                <TD className="mono3" style={MONO11}>1756454646018-0</TD>
                <TD className="mono3" style={R}>5</TD>
                <TD className="mono3" style={DIM11}>
                  orderId=ORD-88213 · amount=129.00 · status=CREATED …
                </TD>
                <TD className="mono3" style={MONO11}>10:24:06.018</TD>
              </TR>
              <TR selected={selected === "1756454646018-1"} onClick={() => setSelected("1756454646018-1")}>
                <TD className="mono3" style={MONO11}>1756454646018-1</TD>
                <TD className="mono3" style={R}>5</TD>
                <TD className="mono3" style={DIM11}>
                  orderId=ORD-88214 · amount=45.00 · status=CREATED …
                </TD>
                <TD className="mono3" style={MONO11}>10:24:06.018</TD>
              </TR>
              <TR selected={selected === "1756454647221-0"} onClick={() => setSelected("1756454647221-0")}>
                <TD className="mono3" style={MONO11}>1756454647221-0</TD>
                <TD className="mono3" style={R}>6</TD>
                <TD className="mono3" style={DIM11}>
                  orderId=ORD-88215 · amount=268.00 · coupon=NEW10 …
                </TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
              </TR>
              <SkeletonRows colSpan={4} widths={["70%", "52%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>entry</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>字段（5）· field / value</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <TBody>
                      {FIELDS.map(([k, v]) => (
                        <TR key={k}>
                          <TD className="mono3" style={{ color: "#8a8a8a", width: "90px" }}>{k}</TD>
                          <TD className="mono3">{v}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>消费状态</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="ok">notify-group 已确认</Status>
                  <Status tone="warn">settle-group PEL 中 · idle 2.1h</Status>
                  <Status tone="off">audit-group 未读到</Status>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>复制</Btn>
              <Btn>以此为模板 XADD</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">XDEL</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid #ebebeb", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "#8a8a8a" }}>
          XRANGE orders:events - + COUNT 100
        </span>
        <span style={{ flex: 1 }} />
        <Btn>‹ 更早</Btn>
        <Btn>更新 ›</Btn>
      </Toolbar>
    </Page>
  );
}
