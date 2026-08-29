import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
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

const SHEET_TABS = ["订阅", "会话", "统计"] as const;
const R = { textAlign: "right" } as const;
const DIM = { color: "#8a8a8a" } as const;
const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "online", label: "在线" },
  { value: "offline", label: "离线（持久会话）" },
] as const;

const SUBS = [
  { filter: "iot/device/cmd/A19F", qos: "1" },
  { filter: "iot/broadcast/#", qos: "0" },
  { filter: "$share/gw/iot/task/#", qos: "1" },
];

/**
 * Board 14d — MQTT has no consumer-group model, so the slot becomes a client
 * and session list: subscriptions, in-flight window, and kick / clear-session.
 */
export function ClientsMqtt() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("订阅");

  return (
    <Page>
      <PageHeader title="客户端 / 会话" subtitle="在线 1 284 · 持久会话离线 96" />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder="搜索 Client ID / IP…" />
        <Seg options={FILTERS} value={filter} onChange={setFilter} />
        <span style={{ flex: 1 }} />
        <SelectField value="按连接时间" />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table>
            <THead>
              <TR>
                <TH>Client ID</TH>
                <TH>用户</TH>
                <TH>IP</TH>
                <TH>协议</TH>
                <TH style={R}>订阅</TH>
                <TH style={R}>飞行/队列</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "sensor-gw-A19F"} onClick={() => setSelected("sensor-gw-A19F")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>sensor-gw-A19F</b>
                </TD>
                <TD>iot-ops</TD>
                <TD className="mono3" style={MONO11}>10.8.0.21</TD>
                <TD>5.0</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={R}>2 / 0</TD>
                <TD><Status tone="ok">在线 6d</Status></TD>
              </TR>
              <TR selected={selected === "sensor-gw-B22C"} onClick={() => setSelected("sensor-gw-B22C")}>
                <TD className="mono3" style={NAME}>sensor-gw-B22C</TD>
                <TD>iot-ops</TD>
                <TD className="mono3" style={MONO11}>10.8.0.22</TD>
                <TD>5.0</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={R}>1 / 0</TD>
                <TD><Status tone="ok">在线 6d</Status></TD>
              </TR>
              <TR selected={selected === "dash-web-9921"} onClick={() => setSelected("dash-web-9921")}>
                <TD className="mono3" style={{ ...NAME, ...DIM }}>dash-web-9921</TD>
                <TD style={DIM}>viewer</TD>
                <TD className="mono3" style={{ ...MONO11, ...DIM }}>—</TD>
                <TD style={DIM}>3.1.1</TD>
                <TD className="mono3" style={{ ...R, ...DIM }}>12</TD>
                <TD className="mono3" style={{ ...R, ...DIM }}>0 / 128</TD>
                <TD><Status tone="off">离线 · 会话保留 1h</Status></TD>
              </TR>
              <SkeletonRows colSpan={7} widths={["64%", "48%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="ok" style={{ fontSize: "10px" }}>在线</Status>}
              tabs={SHEET_TABS}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>订阅（4）</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>topic filter</TH>
                        <TH style={R}>QoS</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {SUBS.map((s) => (
                        <TR key={s.filter}>
                          <TD className="mono3">{s.filter}</TD>
                          <TD className="mono3" style={R}>{s.qos}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <KV
                rows={[
                  ["Keep Alive", "60s · 最后心跳 3s 前"],
                  ["Clean Start", "false · 会话过期 3600s"],
                  ["飞行窗口", <span className="mono3" style={MONO11}>2 / 32</span>],
                  ["收 / 发", <span className="mono3" style={MONO11}>1.2M / 8.4K msg</span>],
                ]}
              />

              <div style={{ fontSize: "11px", color: "#8a8a8a" }}>
                遗嘱：iot/device/status/A19F = offline · QoS1 · retain
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>查看实时消息</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">清除会话</Btn>
              <Btn variant="danger">踢下线</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
