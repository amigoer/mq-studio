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
import { useTranslation } from "react-i18next";

const MONO11 = { fontSize: "11px" } as const;

/** Board 11d — Redis Stream overview. Single-instance view: memory and rates. */
export function OverviewRedis() {
  const { t } = useTranslation();
  return (
    <Page>
      <OverviewHeader subtitle={t("board.overview.redis.subtitle")} />
      <PageBody>
        <div className={KPI_GRID}>
          <StatTile label={t("board.common.mode")} value={t("board.overview.redis.standalone")} hint="uptime 96d" />
          <StatTile label="Stream" value="12" hint={t("board.overview.redis.match")} />
          <StatTile label={t("board.common.consumerGroup")} value="9" hint={t("board.overview.redis.consumers")} />
          <StatTile label={t("board.common.memory")} value="412 MB" hint="/ 2 GB · 20%" />
          <StatTile label={t("board.overview.redis.pel")} value="37" valueColor="var(--c-warn-text)" hint={t("board.overview.redis.idle")} />
        </div>

        <div className={CHART_ROW}>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.redis.cmdRate")}</b>
            <div style={{ display: "flex", gap: "12px", fontSize: "10.5px" }}>
              <span style={{ color: "var(--c-fg)" }}>— XADD</span>
              <span style={{ color: "var(--c-muted)" }}>— XREADGROUP</span>
              <span style={{ color: "var(--c-muted-2)" }}>— XACK</span>
            </div>
            <ChartBox style={{ flex: 1 }}>{t("board.common.chartPlaceholder")}</ChartBox>
          </Card>
          <Card style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>Keyspace</b>
            <MeterRow label={t("board.overview.redis.memUsage")} value={20} />
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
          <CardHeader title={t("board.overview.redis.topLength")} action={<ViewAll />} />
          <Table>
            <THead>
              <TR>
                <TH>Stream</TH>
                <TH style={{ textAlign: "right" }}>XLEN</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.group")}</TH>
                <TH>last-generated-id</TH>
                <TH>{t("board.overview.redis.maxlen")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3">iot:raw</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8.4M</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                <TD className="mono3" style={MONO11}>1756454647221-4</TD>
                <TD><Status tone="warn">{t("board.overview.redis.unbounded")}</Status></TD>
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
