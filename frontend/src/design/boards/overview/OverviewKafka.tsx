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
  Status,
} from "@/components";
import { CHART_CARD, CHART_ROW, KPI_GRID, NAME_CELL, OverviewHeader, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

/** Board 3b — Kafka overview. Partitions get their own KPI; health is URP. */
export function OverviewKafka() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.kafka.subtitle")} />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="Broker" value="3" hint="Controller kafka-1" />
          <StatTile label="Topic" value="42" hint={t("board.overview.kafka.internalHidden")} />
          <StatTile label={t("board.common.partition")} value="386" hint={t("board.overview.kafka.urpOffline")} hintColor="var(--c-warn-text)" />
          <StatTile label={t("board.common.consumerGroup")} value="18" hint={t("board.overview.kafka.rebalancingOne")} />
          <StatTile label={t("board.common.totalBacklog")} value="12 480" valueColor="var(--c-warn-text)" hint={t("board.overview.kafka.vsLastHour")} />
        </div>

        <div className={CHART_ROW}>
          <Panel style={CHART_CARD}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <b style={{ fontSize: "12.5px" }}>{t("board.common.throughput")}</b>
              <span className="flex-1" />
              <span style={{ fontSize: "10.5px", color: "var(--c-ok)" }}>{t("board.overview.kafka.inMsg")}</span>
              <span style={{ fontSize: "10.5px", color: "var(--c-accent-blue)" }}>{t("board.overview.kafka.outMsg")}</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.overview.kafka.chart")}</ChartBox>
          </Panel>
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.kafka.partitionHealth")}</b>
            <ChartBox style={{ flex: 1 }}>
              {t("board.overview.kafka.donut")}
              <br />
              {t("board.overview.kafka.isrLine")}
            </ChartBox>
          </Panel>
        </div>

        <Panel style={TABLE_CARD}>
          <PanelHeader
            title={t("board.common.topBacklogGroups")}
            action={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--c-ok)" }}>
                {t("board.common.viewAll")}
                <ArrowRight size={13} aria-hidden />
              </span>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.consumerGroup")}</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.overview.kafka.lag")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.consumeRate")}</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>settle-consumer</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>orders.created</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>9 820</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 104/s</TableCell>
                <TableCell><Status tone="warn">{t("board.common.backlogAlert")}</Status></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>notify-consumer</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>orders.created</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 220</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2 003/s</TableCell>
                <TableCell><Status tone="ok">{t("board.common.healthy")}</Status></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>audit-pipeline</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>payments.captured</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>840</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>880/s</TableCell>
                <TableCell><Status tone="off">{t("board.overview.kafka.rebalancing")}</Status></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
