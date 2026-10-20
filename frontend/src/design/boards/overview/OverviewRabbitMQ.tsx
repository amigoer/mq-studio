import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Cable, Inbox, Layers, Server, Waypoints } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MeterRow, MiniStat, Panel, PanelHeader, StatTile, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRabbitOverview } from "@/hooks/rabbitmq/useRabbitOverview";
import { formatBytes, formatCount, formatRateWithUnit } from "@/lib/format";
import {
  messagesReady,
  messagesUnacknowledged,
  queueType,
  vhost,
} from "@/mq/rabbitmq/destinations";
import {
  diskFreeAlarm,
  diskHeadroomUsage,
  memoryAlarm,
  memoryUsage,
  partitions,
} from "@/mq/rabbitmq/nodes";
import type { Node } from "@/api/models";
import { KPI_GRID } from "./_shared";

/** How many rows a summary table shows before it stops being a summary. */
const TOP_ROWS = 6;

/**
 * Board 11b — RabbitMQ overview.
 *
 * Three things the canvas drew are gone, because the broker does not report
 * them. There is no connection or channel peak: the management API keeps
 * current totals and no high-water mark. There is no message-rate chart: the
 * throughput history this app records is sampled per node, and RabbitMQ
 * reports rates for the broker and for each queue but never for the node
 * holding them, so every sample would be empty. And there is no disk-usage
 * percentage; see the headroom meter below.
 *
 * Two things it did not draw are here, because they are what RabbitMQ has to
 * say. Unroutable is publishes that matched no binding, which is the first
 * thing worth knowing when messages "disappear" on a wrong topology. A node
 * reporting partitions is a split brain, and nothing else on this page matters
 * while that is true.
 */
export function OverviewRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitOverview();

  const census = state.data?.census ?? null;
  const nodes = state.data?.nodes ?? [];
  const queues = state.data?.queues ?? [];

  const online = nodes.filter((node) => node.status === "online").length;
  const split = nodes.filter((node) => partitions(node).length > 0);

  /* Queue types are what an operator plans capacity by: quorum queues
     replicate and classic ones do not, so the split matters more than the
     total the census already gives. */
  const byType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const queue of queues) {
      const type = queueType(queue);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([type, count]) => `${type} ${count}`)
      .join(" · ");
  }, [queues]);

  const busiest = useMemo(
    () =>
      [...queues]
        .filter((queue) => messagesReady(queue) + messagesUnacknowledged(queue) > 0)
        .sort(
          (left, right) =>
            messagesReady(right) + messagesUnacknowledged(right) -
            (messagesReady(left) + messagesUnacknowledged(left)),
        )
        .slice(0, TOP_ROWS),
    [queues],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.common.overview")}
        subtitle={
          census != null
            ? t("board.overview.rabbitmq.subtitle", {
                cluster: census.clusterName,
                version: census.version,
              })
            : undefined
        }
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={state.refresh}
          />
        }
      />
      <PageBody>
        {/* BoardState draws `empty` whenever it is given one, so it is passed
            only when the broker genuinely answered with nothing. */}
        <BoardState
          state={state}
          empty={census == null ? t("board.overview.rabbitmq.empty") : undefined}
        >
          {census != null && (
            <>
              <div className={KPI_GRID}>
                <StatTile
                  label={t("board.common.node")}
                  icon={Server}
                  tone="slate"
                  value={`${online} / ${nodes.length}`}
                  hint={
                    split.length > 0
                      ? t("board.overview.rabbitmq.partitioned", { count: split.length })
                      : t("board.overview.rabbitmq.allRunning")
                  }
                  hintColor={split.length > 0 ? "var(--c-err-text)" : undefined}
                />
                <StatTile
                  label={t("board.common.queue")}
                  icon={Layers}
                  tone="violet"
                  value={formatCount(census.queues)}
                  hint={byType}
                />
                <StatTile
                  label={t("board.common.exchange")}
                  icon={Waypoints}
                  tone="pink"
                  value={formatCount(census.exchanges)}
                  hint={t("board.overview.rabbitmq.consumers", { count: census.consumers })}
                />
                <StatTile
                  label={t("board.overview.rabbitmq.connChannels")}
                  icon={Cable}
                  tone="blue"
                  value={`${formatCount(census.connections)} / ${formatCount(census.channels)}`}
                  hint={t("board.overview.rabbitmq.connChannelsHint")}
                />
                <StatTile
                  label={t("board.overview.rabbitmq.ready")}
                  icon={Inbox}
                  tone="orange"
                  value={formatCount(census.ready)}
                  valueColor={census.ready > 0 ? "var(--c-warn-text)" : undefined}
                  hint={t("board.overview.rabbitmq.unacked", {
                    count: census.unacknowledged,
                  })}
                />
              </div>

              <div className="mqs-tablerow">
                <Panel>
                  <PanelHeader title={t("board.common.messageRate")} />
                  {/* Current rates rather than a chart. The broker computes
                      these over its own window; nothing here records a series
                      for them, and drawing a placeholder box would promise a
                      history that does not exist. */}
                  <div className="grid grid-cols-3 gap-2 p-4">
                    <MiniStat label="publish" value={formatRateWithUnit(census.rates.publish)} />
                    <MiniStat label="deliver" value={formatRateWithUnit(census.rates.deliver)} />
                    <MiniStat label="ack" value={formatRateWithUnit(census.rates.ack)} />
                    <MiniStat
                      label="redeliver"
                      value={formatRateWithUnit(census.rates.redeliver)}
                      color={census.rates.redeliver > 0 ? "var(--c-warn-text)" : undefined}
                    />
                    <MiniStat
                      label={t("board.overview.rabbitmq.unroutable")}
                      value={formatRateWithUnit(census.rates.unroutable)}
                      color={census.rates.unroutable > 0 ? "var(--c-err-text)" : undefined}
                    />
                  </div>
                </Panel>
                <Panel>
                  <PanelHeader title={t("board.overview.rabbitmq.watermarks")} />
                  <div className="flex flex-col gap-2 p-4">
                    {nodes.map((node) => (
                      <NodeWatermarks key={node.name} node={node} />
                    ))}
                    {nodes.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t("board.overview.rabbitmq.noNodes")}
                      </span>
                    )}
                  </div>
                </Panel>
              </div>

              <Panel className="overflow-hidden">
                <PanelHeader title={t("board.overview.rabbitmq.busiest")} />
                <Table inset="card">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("board.common.queue")}</TableHead>
                      <TableHead>vhost</TableHead>
                      <TableHead>{t("board.common.type")}</TableHead>
                      <TableHead style={{ textAlign: "right" }}>Ready</TableHead>
                      <TableHead style={{ textAlign: "right" }}>Unacked</TableHead>
                      <TableHead style={{ textAlign: "right" }}>
                        {t("board.common.consumers")}
                      </TableHead>
                      <TableHead>{t("board.common.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {busiest.map((queue) => {
                      const ready = messagesReady(queue);
                      const unacked = messagesUnacknowledged(queue);
                      return (
                        <TableRow key={`${queue.ref.namespace}/${queue.ref.name}`}>
                          <TableCell className="select-text">{queue.ref.name}</TableCell>
                          <TableCell className="text-muted-foreground">{vhost(queue)}</TableCell>
                          <TableCell>{queueType(queue)}</TableCell>
                          <TableCell
                            style={{
                              textAlign: "right",
                              color: ready > 0 ? "var(--c-warn-text)" : undefined,
                            }}
                          >
                            {formatCount(ready)}
                          </TableCell>
                          <TableCell style={{ textAlign: "right" }}>{formatCount(unacked)}</TableCell>
                          <TableCell style={{ textAlign: "right" }}>
                            {formatCount(queue.subscribers)}
                          </TableCell>
                          <TableCell>
                            <QueueTone ready={ready} consumers={queue.subscribers} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {busiest.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} style={{ color: "var(--c-muted)" }}>
                          {t("board.overview.rabbitmq.allDrained")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Panel>
            </>
          )}
        </BoardState>
      </PageBody>
    </Page>
  );
}

/**
 * One node's two limits.
 *
 * Memory is a real fraction: the broker knows the watermark it will block
 * publishers at and how much it is using against it. Disk is not - RabbitMQ
 * never reports the size of the disk, only free bytes and the floor it alarms
 * at - so the meter reads how close free space is to that floor, and the bytes
 * are spelled out beside it rather than dressed up as a usage percentage.
 */
function NodeWatermarks({ node }: { node: Node }) {
  const { t } = useTranslation();
  const memory = memoryUsage(node);
  const disk = diskHeadroomUsage(node);
  const stranded = partitions(node);

  return (
    <div className="rounded-lg bg-(--c-fill-soft) px-3 py-2.5 ring-1 ring-(--c-rule) ring-inset">
      <div className="mb-2 truncate text-[12.5px] font-medium select-text">{node.name}</div>
      <div className="flex flex-col gap-1.5">
        {memory != null && (
          <MeterRow
            label={t("board.common.memory")}
            labelWidth={36}
            value={memory}
            color={memoryAlarm(node) ? "var(--c-err)" : memory >= 80 ? "var(--c-warn)" : undefined}
          />
        )}
        {disk != null && (
          <MeterRow
            label={t("board.common.disk")}
            labelWidth={36}
            value={disk}
            display={formatBytes(node.attributes?.diskFree)}
            color={diskFreeAlarm(node) ? "var(--c-err)" : disk >= 80 ? "var(--c-warn)" : undefined}
          />
        )}
      </div>
      {stranded.length > 0 && (
        <div className="mt-2 text-[11px] text-(--c-err-text)">
          {t("board.overview.rabbitmq.partitionWarn", {
            node: node.name,
            peers: stranded.join(", "),
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A queue's health as the two figures actually say it.
 *
 * Ready with nobody attached is the one that needs a person: the messages are
 * deliverable and nothing is taking them.
 */
function QueueTone({ ready, consumers }: { ready: number; consumers: number }) {
  const { t } = useTranslation();
  if (ready > 0 && consumers === 0) {
    return <Status tone="err">{t("board.overview.rabbitmq.noConsumer")}</Status>;
  }
  if (ready > 0) return <Status tone="warn">{t("board.common.backlog")}</Status>;
  return <Status tone="ok">{t("board.common.healthy")}</Status>;
}
