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
  MeterRow,
  Panel,
  PanelHeader,
  StatTile,
  Status,
} from "@/components";
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
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.messageRate")}</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>— publish</span>
              <span style={{ color: "var(--c-muted)" }}>— deliver</span>
              <span style={{ color: "var(--c-muted-2)" }}>— ack</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.common.chartPlaceholder")}</ChartBox>
          </Panel>
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.rabbitmq.watermarks")}</b>
            <MeterRow label={t("board.overview.rabbitmq.node1Mem")} value={48} />
            <MeterRow label={t("board.overview.rabbitmq.node2Mem")} value={52} />
            <MeterRow label={t("board.overview.rabbitmq.node3Mem")} value={88} color="var(--c-warn)" />
            <MeterRow label={t("board.overview.rabbitmq.diskFree")} value={34} />
            <div style={{ fontSize: "10.5px", color: "var(--c-warn-text)" }}>{t("board.overview.rabbitmq.nodeWarn")}</div>
          </Panel>
        </div>

        <Panel style={TABLE_CARD}>
          <PanelHeader title={t("board.overview.rabbitmq.topReady")} action={<ViewAll />} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.queue")}</TableHead>
                <TableHead>vhost</TableHead>
                <TableHead style={{ textAlign: "right" }}>Ready</TableHead>
                <TableHead style={{ textAlign: "right" }}>Unacked</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.consumers")}</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>order.settle.q</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>/order</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>14</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>4</TableCell>
                <TableCell><Status tone="warn">{t("board.common.backlog")}</Status></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>audit.pipeline.q</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>/order</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>120</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell><Status tone="ok">{t("board.common.healthy")}</Status></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>dlx.order.q</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>/order</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-err-text)" }}>37</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
                <TableCell><Status tone="err">{t("board.common.deadLetter")}</Status></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
