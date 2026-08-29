import { Page, PageBody } from "@/design/shell";
import {
  Card,
  CardHeader,
  ChartBox,
  KV,
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
import { CHART_CARD, CHART_ROW, KPI_GRID, OverviewHeader, TABLE_CARD, ViewAll } from "./_shared";

const MONO11 = { fontSize: "11px" } as const;

/** Board 11d — Redis Stream overview. Single-instance view: memory and rates. */
export function OverviewRedis() {
  return (
    <Page>
      <OverviewHeader subtitle="redis-stream-01 · Redis 7.2 · 单机 · db0 · 只读模式关闭" />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label="模式" value="单机" hint="uptime 96d" />
          <StatTile label="Stream" value="12" hint="匹配 orders:* ; events:*" />
          <StatTile label="消费者组" value="9" hint="消费者 21" />
          <StatTile label="内存" value="412 MB" hint="/ 2 GB · 20%" />
          <StatTile label="PEL 待确认" value="37" valueColor="#b45309" hint="最长空闲 2.1h" />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>命令速率</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "#171717" }}>— XADD</span>
              <span style={{ color: "#8a8a8a" }}>— XREADGROUP</span>
              <span style={{ color: "#a3a3a3" }}>— XACK</span>
            </div>
            <ChartBox style={{ flex: 1 }}>折线图占位</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>Keyspace</b>
            <MeterRow label="内存使用" value={20} />
            <KV
              style={{ marginTop: "2px" }}
              rows={[
                ["db0 keys", <span className="mono3" style={MONO11}>1 284</span>],
                ["stream keys", <span className="mono3" style={MONO11}>12</span>],
                ["AOF / RDB", <span className="mono3" style={MONO11}>everysec · 08:00</span>],
              ]}
            />
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <CardHeader title="长度 TOP Stream" action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>Stream</TH>
                <TH style={{ textAlign: "right" }}>XLEN</TH>
                <TH style={{ textAlign: "right" }}>组</TH>
                <TH>last-generated-id</TH>
                <TH>maxlen 策略</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3">iot:raw</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8.4M</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                <TD className="mono3" style={MONO11}>1756454647221-4</TD>
                <TD><Status tone="warn">无上限 · 建议 XTRIM</Status></TD>
              </TR>
              <TR>
                <TD className="mono3">orders:events</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1.2M</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={MONO11}>1756454646018-0</TD>
                <TD><Status tone="ok">~1M approx</Status></TD>
              </TR>
              <TR>
                <TD className="mono3">payments:captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>640K</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={MONO11}>1756454641773-2</TD>
                <TD><Status tone="ok">~500K approx</Status></TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
