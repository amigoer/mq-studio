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
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.subscription", "board.consumers.mqtt.session", "board.consumers.mqtt.stats"] as const;
const R = { textAlign: "right" } as const;
const DIM = { color: "var(--c-muted)" } as const;
const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;

const FILTERS = [
  { value: "all", label: "board.common.all" },
  { value: "online", label: "board.common.online" },
  { value: "offline", label: "board.consumers.mqtt.offlinePersistent" },
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
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.consumers.mqtt.title")} subtitle={t("board.consumers.mqtt.subtitle")} />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder={t("board.consumers.mqtt.search")} />
        <Seg options={FILTERS.map((o) => ({ ...o, label: t(o.label) }))} value={filter} onChange={setFilter} />
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.consumers.mqtt.byConnectTime")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Client ID</TH>
                <TH>{t("board.common.user")}</TH>
                <TH>IP</TH>
                <TH>{t("board.common.protocol")}</TH>
                <TH style={R}>{t("board.common.subscription")}</TH>
                <TH style={R}>{t("board.consumers.mqtt.inflightQueued")}</TH>
                <TH>{t("board.common.status")}</TH>
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
                <TD><Status tone="ok">{t("board.consumers.mqtt.online6d")}</Status></TD>
              </TR>
              <TR selected={selected === "sensor-gw-B22C"} onClick={() => setSelected("sensor-gw-B22C")}>
                <TD className="mono3" style={NAME}>sensor-gw-B22C</TD>
                <TD>iot-ops</TD>
                <TD className="mono3" style={MONO11}>10.8.0.22</TD>
                <TD>5.0</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={R}>1 / 0</TD>
                <TD><Status tone="ok">{t("board.consumers.mqtt.online6d")}</Status></TD>
              </TR>
              <TR selected={selected === "dash-web-9921"} onClick={() => setSelected("dash-web-9921")}>
                <TD className="mono3" style={{ ...NAME, ...DIM }}>dash-web-9921</TD>
                <TD style={DIM}>viewer</TD>
                <TD className="mono3" style={{ ...MONO11, ...DIM }}>—</TD>
                <TD style={DIM}>3.1.1</TD>
                <TD className="mono3" style={{ ...R, ...DIM }}>12</TD>
                <TD className="mono3" style={{ ...R, ...DIM }}>0 / 128</TD>
                <TD><Status tone="off">{t("board.consumers.mqtt.offline1h")}</Status></TD>
              </TR>
              <SkeletonRows colSpan={7} widths={["64%", "48%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="ok" style={{ fontSize: "10px" }}>{t("board.common.online")}</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.mqtt.subsCount")}</SectionLabel>
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
                  ["Keep Alive", t("board.consumers.mqtt.keepAlive")],
                  ["Clean Start", t("board.consumers.mqtt.cleanStart")],
                  [t("board.consumers.mqtt.inflightWindow"), <span className="mono3" style={MONO11}>2 / 32</span>],
                  [t("board.consumers.mqtt.rxTx"), <span className="mono3" style={MONO11}>1.2M / 8.4K msg</span>],
                ]}
              />

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.consumers.mqtt.will")}
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.consumers.mqtt.liveMessages")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.consumers.mqtt.clearSession")}</Btn>
              <Btn variant="danger">{t("board.consumers.mqtt.kick")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
