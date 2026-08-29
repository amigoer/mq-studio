import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import {
  Btn,
  Card,
  CardHeader,
  LineChart,
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
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useOverview } from "@/hooks/useOverview";
import { useSettings } from "@/hooks/useSettings";
import {
  aggregateThroughputHistory,
  continuousHistoryRanges,
} from "@/lib/throughputHistory";
import { brokerId, brokerName, commitLogDiskUsage } from "@/mq/rocketmq/nodes";
import { groupName, subscriptionsOf } from "@/mq/rocketmq/subscriptions";
import { CHART_CARD, CHART_ROW, KPI_GRID, NAME_CELL, TABLE_CARD } from "./_shared";

const UNKNOWN = -1;

function count(value: number | undefined): string {
  return value == null || value === UNKNOWN ? "—" : value.toLocaleString();
}

/** How many rows the backlog table shows before it stops being a summary. */
const TOP_ROWS = 5;

/**
 * Board 11a — RocketMQ overview.
 *
 * The canvas drew a throughput chart as a placeholder box; the collector has
 * been sampling per-broker TPS into a local history all along, so it is a real
 * chart. Both series carry the same unit and share one axis.
 */
export function OverviewRocketMQ() {
  const { t, i18n } = useTranslation();
  const state = useOverview();
  const { settings } = useSettings();
  const lagThreshold = settings.lagAlertThreshold ?? 10000;
  const diskThreshold = settings.diskAlertThreshold ?? 75;

  const nodes = state.data?.nodes ?? [];
  const topics = state.data?.topics ?? [];
  const groups = state.data?.consumerGroups ?? [];
  const overview = state.data?.cluster?.overview;

  const history = useMemo(() => aggregateThroughputHistory(nodes), [nodes]);
  const series = useMemo(() => {
    // A window the collector never sampled is a hole, not a zero, so the line
    // breaks there instead of dropping to the floor.
    const sampled = new Set<number>();
    for (const range of continuousHistoryRanges(history.timestamps)) {
      for (let index = range.start; index <= range.end; index++) sampled.add(index);
    }
    const mask = (values: number[]) =>
      values.map((value, index) => (sampled.has(index) ? value : null));
    return [
      {
        label: t("board.overview.rocketmq.produceMsg"),
        color: "var(--c-series-1)",
        values: mask(history.inbound),
      },
      {
        label: t("board.overview.rocketmq.consumeMsg"),
        color: "var(--c-series-2)",
        values: mask(history.outbound),
      },
    ];
  }, [history, t]);

  const backlogged = useMemo(
    () =>
      [...groups]
        .filter((group) => (group.backlog ?? 0) > 0)
        .sort((left, right) => (right.backlog ?? 0) - (left.backlog ?? 0))
        .slice(0, TOP_ROWS),
    [groups],
  );

  const totalBacklog = groups.reduce(
    (sum, group) => sum + Math.max(0, group.backlog ?? 0),
    0,
  );
  const produceTps = nodes.reduce(
    (sum, node) => sum + Math.max(0, node.rateIn),
    0,
  );
  const consumeTps = nodes.reduce(
    (sum, node) => sum + Math.max(0, node.rateOut),
    0,
  );
  const onlineBrokers = nodes.filter((node) => node.status === "online").length;
  const overDisk = nodes.filter(
    (node) => commitLogDiskUsage(node) !== UNKNOWN && commitLogDiskUsage(node) >= diskThreshold,
  );

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }),
    [i18n.language],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.common.overview")}
        subtitle={
          overview?.name
            ? t("board.overview.rocketmq.liveSubtitle", { cluster: overview.name })
            : t("board.common.overview")
        }
        actions={
          <Btn disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
            {state.refreshing && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
            {t("board.common.refresh")}
          </Btn>
        }
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <PageBody>
          <div className={KPI_GRID}>
            <StatTile
              label="Broker"
              value={count(nodes.length)}
              hint={t("board.overview.rocketmq.online", { count: onlineBrokers })}
            />
            <StatTile
              label="Topic"
              value={count(topics.length)}
              hint={t("board.overview.rocketmq.systemHidden")}
            />
            <StatTile
              label={t("board.common.consumerGroup")}
              value={count(groups.length)}
            />
            <StatTile
              label={t("board.common.produceTps")}
              value={count(produceTps)}
              hint={t("board.overview.rocketmq.consumeRate", { rate: consumeTps.toLocaleString() })}
            />
            <StatTile
              label={t("board.common.totalBacklog")}
              value={count(totalBacklog)}
              valueColor={totalBacklog > lagThreshold ? "var(--c-warn-text)" : undefined}
            />
          </div>

          <div className={CHART_ROW}>
            <Card style={CHART_CARD}>
              <b style={{ fontSize: "12.5px" }}>{t("board.common.throughput")}</b>
              {history.timestamps.length === 0 ? (
                <Notice title={t("board.overview.rocketmq.noHistory")} />
              ) : (
                <LineChart
                  style={{ flex: 1, minHeight: "120px" }}
                  series={series}
                  timestamps={history.timestamps}
                  formatValue={(value) => `${value.toLocaleString()}/s`}
                  formatTime={(timestamp) => timeFormat.format(new Date(timestamp))}
                />
              )}
            </Card>
            <Card style={CHART_CARD}>
              <b style={{ fontSize: "12.5px" }}>{t("board.overview.rocketmq.brokerHealth")}</b>
              {nodes.map((node) => {
                const disk = commitLogDiskUsage(node);
                const label = `${brokerName(node)}${brokerId(node) !== 0 ? `-${brokerId(node)}` : ""}`;
                return (
                  <MeterRow
                    key={label}
                    label={label}
                    value={disk === UNKNOWN ? 0 : disk}
                    color={disk >= diskThreshold ? "var(--c-warn)" : undefined}
                  />
                );
              })}
              {overDisk.length > 0 && (
                <div style={{ fontSize: "10.5px", color: "var(--c-warn-text)" }}>
                  {t("board.overview.rocketmq.diskOver", {
                    count: overDisk.length,
                    threshold: diskThreshold,
                  })}
                </div>
              )}
            </Card>
          </div>

          <Card style={TABLE_CARD}>
            <CardHeader title={t("board.common.topBacklogGroups")} />
            <Table>
              <THead>
                <TR>
                  <TH>{t("board.common.consumerGroup")}</TH>
                  <TH>Topic</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.common.backlog")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.common.consumeTps")}</TH>
                  <TH>{t("board.common.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {backlogged.map((group) => {
                  const backlog = group.backlog ?? 0;
                  const alerting = backlog > lagThreshold;
                  const reads = subscriptionsOf(group)
                    .map((one) => one.topic)
                    .join(", ");
                  return (
                    <TR key={groupName(group)}>
                      <TD>{groupName(group)}</TD>
                      <TD className="mono3" style={NAME_CELL}>
                        {reads || "—"}
                      </TD>
                      <TD
                        className="mono3"
                        style={{
                          textAlign: "right",
                          color: alerting ? "var(--c-warn-text)" : undefined,
                        }}
                      >
                        {backlog.toLocaleString()}
                      </TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>
                        {count(group.rateOut)}
                      </TD>
                      <TD>
                        <Status tone={alerting ? "warn" : "ok"}>
                          {t(alerting ? "board.common.backlogAlert" : "board.common.healthy")}
                        </Status>
                      </TD>
                    </TR>
                  );
                })}
                {backlogged.length === 0 && (
                  <TR>
                    <TD colSpan={5} style={{ padding: "26px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t("board.overview.rocketmq.noBacklog")}
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </Card>
        </PageBody>
      )}
    </Page>
  );
}
