import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelFooter,
  DetailPanelHeader,
  KV,
  Panel,
  SectionLabel,
  Segmented,
  SelectField,
  Status,
} from "@/components";
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
        <Input className="w-[220px] flex-none" placeholder={t("board.consumers.mqtt.search")} />
        <Segmented options={FILTERS.map((o) => ({ ...o, label: t(o.label) }))} value={filter} onChange={setFilter} />
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.consumers.mqtt.byConnectTime") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>Client ID</TableHead>
                <TableHead>{t("board.common.user")}</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>{t("board.common.protocol")}</TableHead>
                <TableHead style={R}>{t("board.common.subscription")}</TableHead>
                <TableHead style={R}>{t("board.consumers.mqtt.inflightQueued")}</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "sensor-gw-A19F"} onClick={() => setSelected("sensor-gw-A19F")}>
                <TableCell>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>sensor-gw-A19F</b>
                </TableCell>
                <TableCell>iot-ops</TableCell>
                <TableCell className="mono3" style={MONO11}>10.8.0.21</TableCell>
                <TableCell>5.0</TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell className="mono3" style={R}>2 / 0</TableCell>
                <TableCell><Status tone="ok">{t("board.consumers.mqtt.online6d")}</Status></TableCell>
              </TableRow>
              <TableRow selected={selected === "sensor-gw-B22C"} onClick={() => setSelected("sensor-gw-B22C")}>
                <TableCell className="mono3" style={NAME}>sensor-gw-B22C</TableCell>
                <TableCell>iot-ops</TableCell>
                <TableCell className="mono3" style={MONO11}>10.8.0.22</TableCell>
                <TableCell>5.0</TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell className="mono3" style={R}>1 / 0</TableCell>
                <TableCell><Status tone="ok">{t("board.consumers.mqtt.online6d")}</Status></TableCell>
              </TableRow>
              <TableRow selected={selected === "dash-web-9921"} onClick={() => setSelected("dash-web-9921")}>
                <TableCell className="mono3" style={{ ...NAME, ...DIM }}>dash-web-9921</TableCell>
                <TableCell style={DIM}>viewer</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, ...DIM }}>—</TableCell>
                <TableCell style={DIM}>3.1.1</TableCell>
                <TableCell className="mono3" style={{ ...R, ...DIM }}>12</TableCell>
                <TableCell className="mono3" style={{ ...R, ...DIM }}>0 / 128</TableCell>
                <TableCell><Status tone="off">{t("board.consumers.mqtt.offline1h")}</Status></TableCell>
              </TableRow>
              <SkeletonRows colSpan={7} widths={["64%", "48%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="ok" style={{ fontSize: "10px" }}>{t("board.common.online")}</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.mqtt.subsCount")}</SectionLabel>
                <Panel style={{ overflow: "hidden" }}>
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>topic filter</TableHead>
                        <TableHead style={R}>QoS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SUBS.map((s) => (
                        <TableRow key={s.filter}>
                          <TableCell className="mono3">{s.filter}</TableCell>
                          <TableCell className="mono3" style={R}>{s.qos}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Panel>
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
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.consumers.mqtt.liveMessages")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.consumers.mqtt.clearSession")}</Button>
              <Button variant="destructive">{t("board.consumers.mqtt.kick")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
