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

/** Board 3b — Kafka overview. Partitions get their own KPI; health is URP. */
export function OverviewKafka() {
  return (
    <Page>
      <OverviewHeader subtitle="prod-kafka-cn · Kafka 3.7 · Controller kafka-1 · 自动刷新 10s" />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="Broker" value="3" hint="Controller kafka-1" />
          <StatTile label="Topic" value="42" hint="已隐藏内部 12 个" />
          <StatTile label="分区" value="386" hint="URP 2 · 离线 0" hintColor="#b45309" />
          <StatTile label="消费者组" value="18" hint="再均衡中 1" />
          <StatTile label="总堆积" value="12 480" valueColor="#b45309" hint="较 1h 前 +8%" />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <b style={{ fontSize: "12.5px" }}>吞吐趋势</b>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "10.5px", color: "#29915d" }}>— 流入 msg/s</span>
              <span style={{ fontSize: "10.5px", color: "#0b64f4" }}>— 流出 msg/s</span>
            </div>
            <ChartBox style={{ flex: 1 }}>折线图占位（复用现有 throughputHistory）</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>分区健康</b>
            <ChartBox style={{ flex: 1 }}>
              环形图占位
              <br />
              同步 384 · URP 2 · 离线 0
            </ChartBox>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader
            title="堆积 TOP 消费者组"
            action={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "#29915d" }}>
                查看全部
                <ArrowRight size={13} aria-hidden />
              </span>
            }
          />
          <Table>
            <THead>
              <TR>
                <TH>消费者组</TH>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>堆积 (lag)</TH>
                <TH style={{ textAlign: "right" }}>消费速率</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>settle-consumer</TD>
                <TD className="mono3" style={NAME_CELL}>orders.created</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "#b45309" }}>9 820</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104/s</TD>
                <TD><Status tone="warn">堆积告警</Status></TD>
              </TR>
              <TR>
                <TD>notify-consumer</TD>
                <TD className="mono3" style={NAME_CELL}>orders.created</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 220</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003/s</TD>
                <TD><Status tone="ok">正常</Status></TD>
              </TR>
              <TR>
                <TD>audit-pipeline</TD>
                <TD className="mono3" style={NAME_CELL}>payments.captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>840</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880/s</TD>
                <TD><Status tone="off">再均衡中</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
