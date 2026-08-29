import { Page, PageBody } from "@/design/shell";
import {
  Card,
  CardHeader,
  ChartBox,
  MeterRow,
  StatTile,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { CHART_CARD, CHART_ROW, KPI_GRID, NAME_CELL, OverviewHeader, TABLE_CARD, ViewAll } from "./_shared";
import { useTranslation } from "react-i18next";

/** Board 11a — RocketMQ overview. */
export function OverviewRocketMQ() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.rocketmq.subtitle")} />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="Broker" value="4" hint={t("board.overview.rocketmq.masters")} />
          <StatTile label="Topic" value="128" hint={t("board.overview.rocketmq.systemHidden")} />
          <StatTile label={t("board.common.consumerGroup")} value="32" hint={t("board.overview.rocketmq.alerts")} />
          <StatTile label={t("board.common.produceTps")} value="3 240" hint={t("board.overview.rocketmq.consume")} />
          <StatTile label={t("board.common.totalBacklog")} value="1 204" valueColor="var(--c-warn-text)" hint={t("board.overview.rocketmq.vsLastHour")} />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.throughput")}</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>{t("board.overview.rocketmq.produceMsg")}</span>
              <span style={{ color: "var(--c-muted)" }}>{t("board.overview.rocketmq.consumeMsg")}</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.common.chartPlaceholder")}</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.rocketmq.brokerHealth")}</b>
            <MeterRow label="broker-a" value={61} />
            <MeterRow label="broker-b" value={87} color="var(--c-warn)" />
            <MeterRow label="broker-a-s" value={60} />
            <MeterRow label="broker-b-s" value={66} />
            <div style={{ fontSize: "10.5px", color: "var(--c-warn-text)" }}>{t("board.overview.rocketmq.diskWarn")}</div>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title={t("board.common.topBacklogGroups")} action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>{t("board.common.consumerGroup")}</TH>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.backlog")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.consumeTps")}</TH>
                <TH>{t("board.common.status")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>order-settle</TD>
                <TD className="mono3" style={NAME_CELL}>ORDER_CREATE</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104</TD>
                <TD><Status tone="warn">{t("board.common.backlogAlert")}</Status></TD>
              </TR>
              <TR>
                <TD>order-notify</TD>
                <TD className="mono3" style={NAME_CELL}>ORDER_CREATE</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>120</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003</TD>
                <TD><Status tone="ok">{t("board.common.healthy")}</Status></TD>
              </TR>
              <TR>
                <TD>risk-audit</TD>
                <TD className="mono3" style={NAME_CELL}>ORDER_PAY</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>41</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880</TD>
                <TD><Status tone="ok">{t("board.common.healthy")}</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
