import { ArrowRight } from "lucide-react";
import { Page, PageBody } from "@/design/shell";
import { Card, CardHeader, ChartBox, StatTile, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { CHART_CARD, CHART_ROW, KPI_GRID, OverviewHeader, TABLE_CARD } from "./_shared";

const METRIC = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;

/** Board 11e — MQTT overview. Everything here is read from the $SYS tree. */
export function OverviewMqtt() {
  return (
    <Page>
      <OverviewHeader subtitle="iot-broker · EMQX 5.4 · MQTT 5.0 · 数据来自 $SYS（只读）" />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="在线客户端" value="1 284" hint="峰值 1 402" />
          <StatTile label="订阅总数" value="3 402" hint="共享订阅 12" />
          <StatTile label="保留消息" value="128" />
          <StatTile label="入站" value="412/s" hint="出站 1 020/s" />
          <StatTile label="丢弃消息" value="0" hint="过期 0" />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>连接数趋势</b>
            <ChartBox style={{ flex: 1 }}>折线图占位（$SYS clients.count）</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>消息速率</b>
            <ChartBox style={{ flex: 1 }}>折线图占位（received / sent）</ChartBox>
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader
            title="$SYS 关键指标"
            action={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--c-fg-2)" }}>
                完整 $SYS 树
                <ArrowRight size={13} aria-hidden />
              </span>
            }
          />
          <Table>
            <THead>
              <TR>
                <TH>指标</TH>
                <TH style={{ textAlign: "right" }}>值</TH>
                <TH>指标</TH>
                <TH style={{ textAlign: "right" }}>值</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3" style={METRIC}>uptime</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>42d 6h</TD>
                <TD className="mono3" style={METRIC}>bytes.received</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1.2 GB</TD>
              </TR>
              <TR>
                <TD className="mono3" style={METRIC}>messages.retained</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>128</TD>
                <TD className="mono3" style={METRIC}>messages.dropped</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <TR>
                <TD className="mono3" style={METRIC}>heap.current</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>812 MB</TD>
                <TD className="mono3" style={METRIC}>subscriptions.shared</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>12</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
