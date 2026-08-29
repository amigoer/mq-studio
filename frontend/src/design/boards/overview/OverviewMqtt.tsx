import { ArrowRight } from "lucide-react";
import { Page, PageBody } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartBox,
  Panel,
  PanelHeader,
  StatTile,
} from "@/components";
import { CHART_CARD, CHART_ROW, KPI_GRID, OverviewHeader, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

const METRIC = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;

/** Board 11e — MQTT overview. Everything here is read from the $SYS tree. */
export function OverviewMqtt() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.mqtt.subtitle")} />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label={t("board.overview.mqtt.onlineClients")} value="1 284" hint={t("board.overview.mqtt.peakClients")} />
          <StatTile label={t("board.overview.mqtt.subscriptions")} value="3 402" hint={t("board.overview.mqtt.shared")} />
          <StatTile label={t("board.overview.mqtt.retained")} value="128" />
          <StatTile label={t("board.overview.mqtt.inbound")} value="412/s" hint={t("board.overview.mqtt.outbound")} />
          <StatTile label={t("board.overview.mqtt.dropped")} value="0" hint={t("board.overview.mqtt.expired")} />
        </div>

        <div className={CHART_ROW}>
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.mqtt.clientTrend")}</b>
            <ChartBox style={{ flex: 1 }}>{t("board.overview.mqtt.clientChart")}</ChartBox>
          </Panel>
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.messageRate")}</b>
            <ChartBox style={{ flex: 1 }}>{t("board.overview.mqtt.rateChart")}</ChartBox>
          </Panel>
        </div>

        <Panel style={TABLE_CARD}>
          <PanelHeader
            title={t("board.overview.mqtt.sysMetrics")}
            action={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--c-fg-2)" }}>
                {t("board.overview.mqtt.fullTree")}
                <ArrowRight size={13} aria-hidden />
              </span>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.metrics")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.value")}</TableHead>
                <TableHead>{t("board.common.metrics")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.value")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="mono3" style={METRIC}>uptime</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>42d 6h</TableCell>
                <TableCell className="mono3" style={METRIC}>bytes.received</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1.2 GB</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="mono3" style={METRIC}>messages.retained</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>128</TableCell>
                <TableCell className="mono3" style={METRIC}>messages.dropped</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="mono3" style={METRIC}>heap.current</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>812 MB</TableCell>
                <TableCell className="mono3" style={METRIC}>subscriptions.shared</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>12</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
