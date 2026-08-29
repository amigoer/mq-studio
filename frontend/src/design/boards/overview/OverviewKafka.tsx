import { ArrowRight } from "lucide-react";
import { Page, PageBody } from "@/design/shell";
import {
  Card,
  CardHeader,
  ChartBox,
  StatTile,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
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
          <Card style={CHART_CARD}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <b style={{ fontSize: "12.5px" }}>{t("board.common.throughput")}</b>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "10.5px", color: "var(--c-ok)" }}>{t("board.overview.kafka.inMsg")}</span>
              <span style={{ fontSize: "10.5px", color: "var(--c-accent-blue)" }}>{t("board.overview.kafka.outMsg")}</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.overview.kafka.chart")}</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.kafka.partitionHealth")}</b>
            <ChartBox style={{ flex: 1 }}>
              {t("board.overview.kafka.donut")}
              <br />
              {t("board.overview.kafka.isrLine")}
            </ChartBox>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader
            title={t("board.common.topBacklogGroups")}
            action={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--c-ok)" }}>
                {t("board.common.viewAll")}
                <ArrowRight size={13} aria-hidden />
              </span>
            }
          />
          <Table>
            <THead>
              <TR>
                <TH>{t("board.common.consumerGroup")}</TH>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>{t("board.overview.kafka.lag")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.consumeRate")}</TH>
                <TH>{t("board.common.status")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>settle-consumer</TD>
                <TD className="mono3" style={NAME_CELL}>orders.created</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>9 820</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104/s</TD>
                <TD><Status tone="warn">{t("board.common.backlogAlert")}</Status></TD>
              </TR>
              <TR>
                <TD>notify-consumer</TD>
                <TD className="mono3" style={NAME_CELL}>orders.created</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 220</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003/s</TD>
                <TD><Status tone="ok">{t("board.common.healthy")}</Status></TD>
              </TR>
              <TR>
                <TD>audit-pipeline</TD>
                <TD className="mono3" style={NAME_CELL}>payments.captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>840</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880/s</TD>
                <TD><Status tone="off">{t("board.overview.kafka.rebalancing")}</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
