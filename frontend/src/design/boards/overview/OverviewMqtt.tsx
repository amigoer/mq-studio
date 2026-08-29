import { ArrowRight } from "lucide-react";
import { Page, PageBody } from "@/design/shell";
import { Card, CardHeader, ChartBox, StatTile, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
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
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.mqtt.clientTrend")}</b>
            <ChartBox style={{ flex: 1 }}>{t("board.overview.mqtt.clientChart")}</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.messageRate")}</b>
            <ChartBox style={{ flex: 1 }}>{t("board.overview.mqtt.rateChart")}</ChartBox>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader
            title={t("board.overview.mqtt.sysMetrics")}
            action={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--c-fg-2)" }}>
                {t("board.overview.mqtt.fullTree")}
                <ArrowRight size={13} aria-hidden />
              </span>
            }
          />
          <Table>
            <THead>
              <TR>
                <TH>{t("board.common.metrics")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.value")}</TH>
                <TH>{t("board.common.metrics")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.value")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3" style={METRIC}>uptime</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>42d 6h</TD>
                <TD className="mono3" style={METRIC}>bytes.received</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1.2 GB</TD>
              </TR>
              <TR>
                <TD className="mono3" style={METRIC}>messages.retained</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>128</TD>
                <TD className="mono3" style={METRIC}>messages.dropped</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <TR>
                <TD className="mono3" style={METRIC}>heap.current</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>812 MB</TD>
                <TD className="mono3" style={METRIC}>subscriptions.shared</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>12</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
