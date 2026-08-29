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
} from "@/components";
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
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.common.throughput")}</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>— in msg/s</span>
              <span style={{ color: "var(--c-muted)" }}>— out msg/s</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.common.chartPlaceholder")}</ChartBox>
          </Panel>
          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.pulsar.bookieStorage")}</b>
            <MeterRow label="bookie-1" value={58} />
            <MeterRow label="bookie-2" value={61} />
            <MeterRow label="bookie-3" value={57} />
            <MeterRow label="bookie-4" value={73} />
            <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.overview.pulsar.ledgerBalanced")}</div>
          </Panel>
        </div>

        <Panel style={TABLE_CARD}>
          <PanelHeader title={t("board.overview.pulsar.topPending")} action={<ViewAll />} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.subscription")}</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>{t("board.common.type")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.pending")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.outRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>settle-sub</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>
                  persistent://ecommerce/orders/order-created
                </TableCell>
                <TableCell>Shared</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>6 210</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 104/s</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>audit-sub</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>…/orders/payment-captured</TableCell>
                <TableCell>Failover</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 830</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>880/s</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>notify-sub</TableCell>
                <TableCell className="mono3" style={NAME_CELL}>…/orders/order-created</TableCell>
                <TableCell>Key_Shared</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>381</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2 003/s</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
