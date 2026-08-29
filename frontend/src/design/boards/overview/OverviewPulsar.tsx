import { Page, PageBody } from "@/design/shell";
import {
  Card,
  CardHeader,
  ChartBox,
  MeterRow,
  StatTile,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { CHART_CARD, CHART_ROW, KPI_GRID, NAME_CELL, OverviewHeader, TABLE_CARD, ViewAll } from "./_shared";
import { useTranslation } from "react-i18next";

/** Board 11c — Pulsar overview. Two storage tiers: brokers and bookies. */
export function OverviewPulsar() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.pulsar.subtitle")} />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="Broker / Bookie" value="3 / 4" hint={t("board.overview.pulsar.allOnline")} />
          <StatTile label={t("board.common.namespace")} value="14" hint={t("board.overview.pulsar.tenants")} />
          <StatTile label="Topic" value="220" hint={t("board.overview.pulsar.partitioned")} />
          <StatTile label={t("board.common.throughputShort")} value="1.8k/s" hint={t("board.overview.pulsar.outRate")} />
          <StatTile label={t("board.overview.pulsar.totalPending")} value="8 421" valueColor="var(--c-warn-text)" hint={t("board.overview.pulsar.vsLastHour")} />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.throughput")}</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>— in msg/s</span>
              <span style={{ color: "var(--c-muted)" }}>— out msg/s</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.common.chartPlaceholder")}</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.pulsar.bookieStorage")}</b>
            <MeterRow label="bookie-1" value={58} />
            <MeterRow label="bookie-2" value={61} />
            <MeterRow label="bookie-3" value={57} />
            <MeterRow label="bookie-4" value={73} />
            <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.overview.pulsar.ledgerBalanced")}</div>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title={t("board.overview.pulsar.topPending")} action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>{t("board.common.subscription")}</TH>
                <TH>Topic</TH>
                <TH>{t("board.common.type")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.pending")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.outRate")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>settle-sub</TD>
                <TD className="mono3" style={NAME_CELL}>
                  persistent://ecommerce/orders/order-created
                </TD>
                <TD>Shared</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>6 210</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104/s</TD>
              </TR>
              <TR>
                <TD>audit-sub</TD>
                <TD className="mono3" style={NAME_CELL}>…/orders/payment-captured</TD>
                <TD>Failover</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 830</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880/s</TD>
              </TR>
              <TR>
                <TD>notify-sub</TD>
                <TD className="mono3" style={NAME_CELL}>…/orders/order-created</TD>
                <TD>Key_Shared</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>381</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003/s</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
