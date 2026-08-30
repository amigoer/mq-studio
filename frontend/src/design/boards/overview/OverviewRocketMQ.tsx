import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RotateCcw, Search, Send } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MeterRow,
  Panel,
  PanelHeader,
  StatTile,
  Status,
} from "@/components";
import { LineChart } from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useOverview } from "@/hooks/useOverview";
import { useSettings } from "@/hooks/useSettings";
import {
  aggregateThroughputHistory,
  continuousHistoryRanges,
} from "@/lib/throughputHistory";
import { brokerId, brokerName, commitLogDiskUsage } from "@/mq/rocketmq/nodes";
import { topicName } from "@/mq/rocketmq/destinations";
import { groupName, subscriptionsOf } from "@/mq/rocketmq/subscriptions";
import type { BoardProps } from "@/design/registry";
import type { PageId } from "@/design/data/protocols";
import { CHART_CARD, CHART_ROW, KPI_GRID, NAME_CELL, TABLE_CARD } from "./_shared";

const UNKNOWN = -1;

function count(value: number | undefined): string {
  return value == null || value === UNKNOWN ? "—" : value.toLocaleString();
}

/** How many rows a summary table shows before it stops being a summary. */
const TOP_ROWS = 5;

/**
 * The four gestures the overview is a jumping-off point for. Each lands on the
 * page that performs it; "新建 Topic" also opens the form on arrival, because
 * the page alone is not what was asked for.
 */
const SHORTCUTS: readonly {
  key: string;
  icon: typeof Send;
  page: PageId;
  create?: boolean;
}[] = [
  { key: "send", icon: Send, page: "producer" },
  { key: "search", icon: Search, page: "messages" },
  { key: "create", icon: Plus, page: "topics", create: true },
  { key: "reset", icon: RotateCcw, page: "consumers" },
];

/**
 * Board 11a — RocketMQ overview.
 *
 * The canvas drew a throughput chart as a placeholder box; the collector has
 * been sampling per-broker TPS into a local history all along, so it is a real
 * chart. Both series carry the same unit and share one axis.
 */
export function OverviewRocketMQ({ nav }: BoardProps = {}) {
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

  // Traffic first, because a topic nothing is writing to is not what an
  // overview is for; the rest keep their order so the panel is never empty.
  const activeTopics = useMemo(
    () =>
      [...topics]
        .sort((left, right) => right.rateIn - left.rateIn)
        .slice(0, TOP_ROWS),
    [topics],
  );

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
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
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

          <div className="mqs-shortcuts">
            {SHORTCUTS.map((shortcut) => (
              <Button
                key={shortcut.key}
                variant="outline"
                className="h-auto justify-start gap-2 px-3 py-2.5 text-xs font-normal"
                disabled={!state.online || nav?.onOpenPage == null}
                onClick={() =>
                  nav?.onOpenPage?.(
                    shortcut.page,
                    shortcut.create === true ? { create: true } : undefined,
                  )
                }
              >
                <shortcut.icon size={14} aria-hidden />
                {t(`board.overview.rocketmq.shortcut.${shortcut.key}`)}
              </Button>
            ))}
          </div>

          <div className={CHART_ROW}>
            <Panel style={CHART_CARD}>
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
            </Panel>
            <Panel style={CHART_CARD}>
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
            </Panel>
          </div>

          <Panel style={CHART_CARD}>
            <b style={{ fontSize: "12.5px" }}>{t("board.overview.rocketmq.activeTopics")}</b>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.produceTps")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.topics.rocketmq.queueRW")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.consumerGroup")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTopics.map((topic) => (
                  <TableRow key={topicName(topic)}>
                    <TableCell className="mono3" style={NAME_CELL}>
                      {topicName(topic)}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {count(topic.rateIn)}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {count(topic.partitions)}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {count(topic.subscribers)}
                    </TableCell>
                  </TableRow>
                ))}
                {activeTopics.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} style={{ padding: "20px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t("board.overview.rocketmq.noTopics")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Panel>

          <Panel style={TABLE_CARD}>
            <PanelHeader title={t("board.common.topBacklogGroups")} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.consumerGroup")}</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.backlog")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.consumeTps")}</TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backlogged.map((group) => {
                  const backlog = group.backlog ?? 0;
                  const alerting = backlog > lagThreshold;
                  const reads = subscriptionsOf(group)
                    .map((one) => one.topic)
                    .join(", ");
                  return (
                    <TableRow key={groupName(group)}>
                      <TableCell>{groupName(group)}</TableCell>
                      <TableCell className="mono3" style={NAME_CELL}>
                        {reads || "—"}
                      </TableCell>
                      <TableCell
                        className="mono3"
                        style={{
                          textAlign: "right",
                          color: alerting ? "var(--c-warn-text)" : undefined,
                        }}
                      >
                        {backlog.toLocaleString()}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {count(group.rateOut)}
                      </TableCell>
                      <TableCell>
                        <Status tone={alerting ? "warn" : "ok"}>
                          {t(alerting ? "board.common.backlogAlert" : "board.common.healthy")}
                        </Status>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {backlogged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} style={{ padding: "26px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t("board.overview.rocketmq.noBacklog")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Panel>
        </PageBody>
      )}
    </Page>
  );
}
