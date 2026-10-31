import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Activity, ChevronRight, Inbox, Layers, Plus, RotateCcw, Search, Send, Server, Users } from "lucide-react";
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
  Bar,
  LineChart,
  Panel,
  PanelHeader,
  SeriesLegend,
  StatTile,
  Status,
} from "@/components";
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
import { CHART_CARD, CHART_ROW, KPI_GRID } from "./_shared";

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
              icon={Server}
              tone="slate"
              value={count(nodes.length)}
              hint={t("board.overview.rocketmq.online", { count: onlineBrokers })}
            />
            <StatTile
              label="Topic"
              icon={Layers}
              tone="violet"
              value={count(topics.length)}
              hint={t("board.overview.rocketmq.systemHidden")}
            />
            <StatTile
              label={t("board.common.consumerGroup")}
              icon={Users}
              tone="teal"
              value={count(groups.length)}
            />
            <StatTile
              label={t("board.common.produceTps")}
              icon={Activity}
              tone="blue"
              value={count(produceTps)}
              hint={t("board.overview.rocketmq.consumeRate", { rate: consumeTps.toLocaleString() })}
            />
            <StatTile
              label={t("board.common.totalBacklog")}
              icon={Inbox}
              tone="orange"
              value={count(totalBacklog)}
              valueColor={totalBacklog > lagThreshold ? "var(--c-warn-text)" : undefined}
            />
          </div>

          <div className="mqs-shortcuts">
            {SHORTCUTS.map((shortcut) => (
              <Button
                key={shortcut.key}
                variant="outline"
                className="h-10 justify-start gap-2.5 rounded-lg px-2.5 text-[12.5px] font-normal text-(--c-fg-2) hover:text-foreground"
                disabled={!state.online || nav?.onOpenPage == null}
                onClick={() =>
                  nav?.onOpenPage?.(
                    shortcut.page,
                    shortcut.create === true ? { create: true } : undefined,
                  )
                }
              >
                <span className="flex size-6 flex-none items-center justify-center rounded-md bg-(--c-primary-soft) text-(--c-primary)">
                  <shortcut.icon className="size-3.5" aria-hidden />
                </span>
                {t(`board.overview.rocketmq.shortcut.${shortcut.key}`)}
              </Button>
            ))}
          </div>

          <div className={CHART_ROW}>
            <Panel style={CHART_CARD}>
              <div className="flex items-center gap-3">
                <b className="text-[13px] font-semibold">{t("board.common.throughput")}</b>
                <span className="flex-1" />
                {history.timestamps.length > 0 && <SeriesLegend series={series} />}
              </div>
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
              <div className="flex items-center gap-3">
                <b className="text-[13px] font-semibold">{t("board.overview.rocketmq.brokerHealth")}</b>
                <span className="flex-1" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("board.overview.rocketmq.brokersOnline", {
                    online: onlineBrokers,
                    total: nodes.length,
                  })}
                </span>
              </div>
              <div className="mqs-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-2 px-1">
                {nodes.map((node) => {
                  const disk = commitLogDiskUsage(node);
                  const label = `${brokerName(node)}${brokerId(node) !== 0 ? `-${brokerId(node)}` : ""}`;
                  return (
                    <BrokerRow
                      key={label}
                      label={label}
                      address={node.address}
                      online={node.status === "online"}
                      disk={disk}
                      over={disk !== UNKNOWN && disk >= diskThreshold}
                      rateIn={node.rateIn}
                      rateOut={node.rateOut}
                    />
                  );
                })}
              </div>
              {overDisk.length > 0 && (
                <div className="text-[11px] text-(--c-warn-text)">
                  {t("board.overview.rocketmq.diskOver", {
                    count: overDisk.length,
                    threshold: diskThreshold,
                  })}
                </div>
              )}
            </Panel>
          </div>

          <div className="mqs-tablerow">
            <Panel className="overflow-hidden">
              <PanelHeader
                title={t("board.overview.rocketmq.activeTopics")}
                action={
                  <ViewAll
                    disabled={nav?.onOpenPage == null}
                    onClick={() => nav?.onOpenPage?.("topics")}
                  />
                }
              />
              <Table inset="card">
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
                      <TableCell className="max-w-56 truncate font-medium select-text">
                        {topicName(topic)}
                      </TableCell>
                      <TableCell style={{ textAlign: "right" }}>{count(topic.rateIn)}</TableCell>
                      <TableCell className="text-muted-foreground" style={{ textAlign: "right" }}>
                        {count(topic.partitions)}
                      </TableCell>
                      <TableCell className="text-muted-foreground" style={{ textAlign: "right" }}>
                        {count(topic.subscribers)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {activeTopics.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} style={{ padding: "26px", textAlign: "center", color: "var(--c-muted)" }}>
                        {t("board.overview.rocketmq.noTopics")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader
                title={t("board.common.topBacklogGroups")}
                action={
                  <ViewAll
                    disabled={nav?.onOpenPage == null}
                    onClick={() => nav?.onOpenPage?.("consumers")}
                  />
                }
              />
              <Table inset="card">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.common.consumerGroup")}</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead style={{ textAlign: "right" }}>{t("board.common.backlog")}</TableHead>
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
                        <TableCell className="max-w-44 truncate font-medium select-text">
                          {groupName(group)}
                        </TableCell>
                        {/* Takes what the other columns leave, so a long topic list
                            ends in an ellipsis instead of pushing the status out of
                            the card. */}
                        <TableCell className="w-full max-w-0 truncate text-muted-foreground select-text">
                          {reads || "—"}
                        </TableCell>
                        <TableCell
                          style={{
                            textAlign: "right",
                            color: alerting ? "var(--c-warn-text)" : undefined,
                          }}
                        >
                          {backlog.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Status tone={alerting ? "warn" : "ok"} dot>
                            {t(alerting ? "board.common.backlogAlert" : "board.common.healthy")}
                          </Status>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {backlogged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} style={{ padding: "26px", textAlign: "center", color: "var(--c-muted)" }}>
                        {t("board.overview.rocketmq.noBacklog")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Panel>
          </div>
        </PageBody>
      )}
    </Page>
  );
}

/** The link from a ranking card to the page that holds the whole list. */
function ViewAll({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="xs"
      className="-mr-1.5 gap-0.5 font-normal text-(--c-primary-text) hover:text-(--c-primary-text)"
      disabled={disabled}
      onClick={onClick}
    >
      {t("board.overview.rocketmq.viewAll")}
      <ChevronRight aria-hidden />
    </Button>
  );
}

/**
 * One broker in the health card: whether it answers, how full its CommitLog
 * disk is against the alert threshold, and what is moving through it.
 */
function BrokerRow({
  label,
  address,
  online,
  disk,
  over,
  rateIn,
  rateOut,
}: {
  label: string;
  address: string;
  online: boolean;
  disk: number;
  over: boolean;
  rateIn: number;
  rateOut: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-(--c-fill-soft) px-3 py-2.5 ring-1 ring-(--c-rule) ring-inset">
      <div className="flex items-center gap-2">
        <span
          className="size-1.5 flex-none rounded-full"
          style={{ background: online ? "var(--c-ok)" : "var(--c-muted-2)" }}
          aria-hidden
        />
        <span className="text-[12.5px] font-medium select-text">{label}</span>
        <span className="mono3 ml-auto truncate text-[11px] text-muted-foreground">{address}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
        <span className="flex-none">{t("board.overview.rocketmq.commitLog")}</span>
        <Bar
          value={disk === UNKNOWN ? 0 : disk}
          color={over ? "var(--c-warn)" : "var(--c-ok)"}
          className="flex-1"
        />
        <span className="w-8 flex-none text-right text-(--c-fg-2) tabular-nums">
          {disk === UNKNOWN ? "—" : `${disk}%`}
        </span>
      </div>
      <div className="mt-1.5 flex gap-4 text-[11px] text-muted-foreground tabular-nums">
        <span>
          {t("board.common.in")} <span className="text-(--c-fg-2)">{count(rateIn)}/s</span>
        </span>
        <span>
          {t("board.common.out")} <span className="text-(--c-fg-2)">{count(rateOut)}/s</span>
        </span>
      </div>
    </div>
  );
}
