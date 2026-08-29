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

/** Board 11b — RabbitMQ overview, sourced from the management API. */
export function OverviewRabbitMQ() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.rabbitmq.subtitle")} />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label={t("board.common.node")} value="3" hint={t("board.overview.rabbitmq.allRunning")} />
          <StatTile label={t("board.common.queue")} value="46" hint="quorum 18 · classic 24" />
          <StatTile label={t("board.overview.rabbitmq.connChannels")} value="128 / 342" hint={t("board.overview.rabbitmq.peak")} />
          <StatTile label={t("board.overview.rabbitmq.publishRate")} value="2 980/s" hint={t("board.overview.rabbitmq.deliverRate")} />
          <StatTile label={t("board.overview.rabbitmq.ready")} value="1 139" valueColor="var(--c-warn-text)" hint="Unacked 16" />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.messageRate")}</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>— publish</span>
              <span style={{ color: "var(--c-muted)" }}>— deliver</span>
              <span style={{ color: "var(--c-muted-2)" }}>— ack</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.common.chartPlaceholder")}</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.rabbitmq.watermarks")}</b>
            <MeterRow label={t("board.overview.rabbitmq.node1Mem")} value={48} />
            <MeterRow label={t("board.overview.rabbitmq.node2Mem")} value={52} />
            <MeterRow label={t("board.overview.rabbitmq.node3Mem")} value={88} color="var(--c-warn)" />
            <MeterRow label={t("board.overview.rabbitmq.diskFree")} value={34} />
            <div style={{ fontSize: "10.5px", color: "var(--c-warn-text)" }}>{t("board.overview.rabbitmq.nodeWarn")}</div>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title={t("board.overview.rabbitmq.topReady")} action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>{t("board.common.queue")}</TH>
                <TH>vhost</TH>
                <TH style={{ textAlign: "right" }}>Ready</TH>
                <TH style={{ textAlign: "right" }}>Unacked</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.consumers")}</TH>
                <TH>{t("board.common.status")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>order.settle.q</TD>
                <TD className="mono3" style={NAME_CELL}>/order</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>14</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD><Status tone="warn">{t("board.common.backlog")}</Status></TD>
              </TR>
              <TR>
                <TD>audit.pipeline.q</TD>
                <TD className="mono3" style={NAME_CELL}>/order</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>120</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD><Status tone="ok">{t("board.common.healthy")}</Status></TD>
              </TR>
              <TR>
                <TD>dlx.order.q</TD>
                <TD className="mono3" style={NAME_CELL}>/order</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-err-text)" }}>37</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD><Status tone="err">{t("board.common.deadLetter")}</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
