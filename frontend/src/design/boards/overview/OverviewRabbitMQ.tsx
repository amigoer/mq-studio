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

/** Board 11b — RabbitMQ overview, sourced from the management API. */
export function OverviewRabbitMQ() {
  return (
    <Page>
      <OverviewHeader subtitle="rabbit-staging · RabbitMQ 3.13 · 集群 3 节点 · vhost /order" />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="节点" value="3" hint="全部 running" />
          <StatTile label="队列" value="46" hint="quorum 18 · classic 24" />
          <StatTile label="连接 / 信道" value="128 / 342" hint="峰值 09:40" />
          <StatTile label="发布速率" value="2 980/s" hint="投递 2 903/s" />
          <StatTile label="Ready 消息" value="1 139" valueColor="#b45309" hint="Unacked 16" />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>消息速率</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "#171717" }}>— publish</span>
              <span style={{ color: "#8a8a8a" }}>— deliver</span>
              <span style={{ color: "#a3a3a3" }}>— ack</span>
            </div>
            <ChartBox style={{ flex: 1 }}>折线图占位</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>节点水位</b>
            <MeterRow label="node1 内存" value={48} />
            <MeterRow label="node2 内存" value={52} />
            <MeterRow label="node3 内存" value={88} color="#d97706" />
            <MeterRow label="磁盘 free" value={34} />
            <div style={{ fontSize: "10.5px", color: "#b45309" }}>node3 逼近 vm_memory 高水位</div>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title="Ready TOP 队列" action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>队列</TH>
                <TH>vhost</TH>
                <TH style={{ textAlign: "right" }}>Ready</TH>
                <TH style={{ textAlign: "right" }}>Unacked</TH>
                <TH style={{ textAlign: "right" }}>消费者</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>order.settle.q</TD>
                <TD className="mono3" style={NAME_CELL}>/order</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "#b45309" }}>982</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>14</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD><Status tone="warn">堆积</Status></TD>
              </TR>
              <TR>
                <TD>audit.pipeline.q</TD>
                <TD className="mono3" style={NAME_CELL}>/order</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>120</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD><Status tone="ok">正常</Status></TD>
              </TR>
              <TR>
                <TD>dlx.order.q</TD>
                <TD className="mono3" style={NAME_CELL}>/order</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "#b91c1c" }}>37</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD><Status tone="err">死信</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
