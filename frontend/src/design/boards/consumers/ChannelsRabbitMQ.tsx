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
  SelectField,
  Status,
} from "@/components";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.channel", "board.common.properties"] as const;
const R = { textAlign: "right" } as const;
const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 14e — RabbitMQ has no consumer groups, so the slot becomes the
 * connection → channel → consumer tree. prefetch vs unacked locates a stall.
 */
export function ChannelsRabbitMQ() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.consumers.rabbitmq.title")} subtitle={t("board.consumers.rabbitmq.subtitle")} />
      <Toolbar>
        <Input className="w-[220px] flex-none" placeholder={t("board.consumers.rabbitmq.search")} />
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.consumers.rabbitmq.sortByUnacked") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.connections")}</TableHead>
                <TableHead>{t("board.common.user")}</TableHead>
                <TableHead style={R}>{t("board.common.channel")}</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
                <TableHead style={R}>{t("board.consumers.rabbitmq.rxTx")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "10.2.3.4:52210"} onClick={() => setSelected("10.2.3.4:52210")}>
                <TableCell>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>10.2.3.4:52210</b>
                </TableCell>
                <TableCell>settle-svc</TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell><Status tone="warn">flow</Status></TableCell>
                <TableCell className="mono3" style={R}>1 104 / 0 msg/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "10.2.3.5:52344"} onClick={() => setSelected("10.2.3.5:52344")}>
                <TableCell className="mono3" style={NAME}>10.2.3.5:52344</TableCell>
                <TableCell>settle-svc</TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell><Status tone="ok">running</Status></TableCell>
                <TableCell className="mono3" style={R}>998 / 0</TableCell>
              </TableRow>
              <TableRow selected={selected === "10.2.4.1:41022"} onClick={() => setSelected("10.2.4.1:41022")}>
                <TableCell className="mono3" style={NAME}>10.2.4.1:41022</TableCell>
                <TableCell>order-svc</TableCell>
                <TableCell className="mono3" style={R}>2</TableCell>
                <TableCell><Status tone="ok">running</Status></TableCell>
                <TableCell className="mono3" style={R}>0 / 2 980</TableCell>
              </TableRow>
              <SkeletonRows colSpan={5} widths={["60%", "44%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="warn" style={{ fontSize: "10px" }}>flow</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.rabbitmq.channelsCount")}</SectionLabel>
                <Panel style={{ overflow: "hidden" }}>
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead style={R}>#</TableHead>
                        <TableHead>consumer tag</TableHead>
                        <TableHead style={R}>prefetch</TableHead>
                        <TableHead style={R}>unacked</TableHead>
                        <TableHead style={R}>ack/s</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="mono3" style={R}>1</TableCell>
                        <TableCell className="mono3">ctag-settle-1</TableCell>
                        <TableCell className="mono3" style={R}>50</TableCell>
                        <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>50</TableCell>
                        <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>0</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="mono3" style={R}>2</TableCell>
                        <TableCell className="mono3">ctag-settle-2</TableCell>
                        <TableCell className="mono3" style={R}>50</TableCell>
                        <TableCell className="mono3" style={R}>12</TableCell>
                        <TableCell className="mono3" style={R}>280</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Panel>
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-warn-text)" }}>
                {t("board.consumers.rabbitmq.stallWarn")}
              </div>

              <KV
                rows={[
                  [t("board.common.client"), <span className="mono3" style={MONO11}>java-amqp-client 5.20</span>],
                  [t("board.consumers.rabbitmq.heartbeat"), "60s"],
                  ["TLS", "TLSv1.3"],
                ]}
              />
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.consumers.rabbitmq.viewQueues")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.consumers.rabbitmq.closeConnection")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
