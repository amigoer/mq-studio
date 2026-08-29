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

/** Board 11c — Pulsar overview. Two storage tiers: brokers and bookies. */
export function OverviewPulsar() {
  return (
    <Page>
      <OverviewHeader subtitle="pulsar-eu · Pulsar 3.2 · 租户 ecommerce · Broker 3 / Bookie 4" />
      <PageBody>
        <div style={KPI_GRID}>
          <StatTile label="Broker / Bookie" value="3 / 4" hint="全部在线" />
          <StatTile label="命名空间" value="14" hint="租户 6" />
          <StatTile label="Topic" value="220" hint="分区 Topic 38" />
          <StatTile label="吞吐" value="1.8k/s" hint="出 2.1k/s" />
          <StatTile label="总积压" value="8 421" valueColor="#b45309" hint="较 1h 前 +6%" />
        </div>

        <div style={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>吞吐趋势</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "#171717" }}>— in msg/s</span>
              <span style={{ color: "#8a8a8a" }}>— out msg/s</span>
            </div>
            <ChartBox style={{ flex: 1 }}>折线图占位</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>Bookie 存储</b>
            <MeterRow label="bookie-1" value={58} />
            <MeterRow label="bookie-2" value={61} />
            <MeterRow label="bookie-3" value={57} />
            <MeterRow label="bookie-4" value={73} />
            <div style={{ fontSize: "10.5px", color: "#8a8a8a" }}>Ledger 均衡 · 无只读 Bookie</div>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title="积压 TOP 订阅" action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>订阅</TH>
                <TH>Topic</TH>
                <TH>类型</TH>
                <TH style={{ textAlign: "right" }}>积压</TH>
                <TH style={{ textAlign: "right" }}>出速率</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>settle-sub</TD>
                <TD className="mono3" style={NAME_CELL}>
                  persistent://ecommerce/orders/order-created
                </TD>
                <TD>Shared</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "#b45309" }}>6 210</TD>
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
