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

/** Board 11a — RocketMQ overview. */
export function OverviewRocketMQ() {
  return (
    <Page>
      <OverviewHeader subtitle="rocketmq-order · RocketMQ 5.1.4 · DefaultCluster · 自动刷新 10s" />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="Broker" value="4" hint="2 主 2 从" />
          <StatTile label="Topic" value="128" hint="系统 Topic 已隐藏" />
          <StatTile label="消费者组" value="32" hint="2 个告警" />
          <StatTile label="生产 TPS" value="3 240" hint="消费 3 118" />
          <StatTile label="总堆积" value="1 204" valueColor="var(--c-warn-text)" hint="较 1h 前 +12%" />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>吞吐趋势</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>— 生产 msg/s</span>
              <span style={{ color: "var(--c-muted)" }}>— 消费 msg/s</span>
            </div>
            <ChartBox style={{ flex: 1 }}>折线图占位</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>Broker 健康</b>
            <MeterRow label="broker-a" value={61} />
            <MeterRow label="broker-b" value={87} color="var(--c-warn)" />
            <MeterRow label="broker-a-s" value={60} />
            <MeterRow label="broker-b-s" value={66} />
            <div style={{ fontSize: "10.5px", color: "var(--c-warn-text)" }}>broker-b 磁盘超 85% 水位</div>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title="堆积 TOP 消费者组" action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>消费者组</TH>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>堆积</TH>
                <TH style={{ textAlign: "right" }}>消费 TPS</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>order-settle</TD>
                <TD className="mono3" style={NAME_CELL}>ORDER_CREATE</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104</TD>
                <TD><Status tone="warn">堆积告警</Status></TD>
              </TR>
              <TR>
                <TD>order-notify</TD>
                <TD className="mono3" style={NAME_CELL}>ORDER_CREATE</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>120</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003</TD>
                <TD><Status tone="ok">正常</Status></TD>
              </TR>
              <TR>
                <TD>risk-audit</TD>
                <TD className="mono3" style={NAME_CELL}>ORDER_PAY</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>41</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880</TD>
                <TD><Status tone="ok">正常</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
