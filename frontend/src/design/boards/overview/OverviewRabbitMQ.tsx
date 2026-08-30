import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KV, MeterRow, Panel, PanelHeader, StatTile, Status } from "@/components";
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
import { CHART_CARD, CHART_ROW, KPI_GRID, NAME_CELL, TABLE_CARD } from "./_shared";

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
                  value={formatCount(census.queues)}
                  hint={byType}
                />
                <StatTile
                  label={t("board.common.exchange")}
                  value={formatCount(census.exchanges)}
                  hint={t("board.overview.rabbitmq.consumers", { count: census.consumers })}
                />
                <StatTile
                  label={t("board.overview.rabbitmq.connChannels")}
                  value={`${formatCount(census.connections)} / ${formatCount(census.channels)}`}
                  hint={t("board.overview.rabbitmq.connChannelsHint")}
                />
                <StatTile
                  label={t("board.overview.rabbitmq.ready")}
                  value={formatCount(census.ready)}
                  valueColor={census.ready > 0 ? "var(--c-warn-text)" : undefined}
                  hint={t("board.overview.rabbitmq.unacked", {
                    count: census.unacknowledged,
                  })}
                />
              </div>

              <div className={CHART_ROW}>
                <Panel style={CHART_CARD}>
                  <b style={{ fontSize: "12.5px" }}>{t("board.common.messageRate")}</b>
                  {/* Current rates rather than a chart. The broker computes
                      these over its own window; nothing here records a series
                      for them, and drawing a placeholder box would promise a
                      history that does not exist. */}
                  <KV
                    rows={[
                      ["publish", formatRateWithUnit(census.rates.publish)],
                      ["deliver", formatRateWithUnit(census.rates.deliver)],
                      ["ack", formatRateWithUnit(census.rates.ack)],
                      [
                        "redeliver",
                        <Tone key="redeliver" bad={census.rates.redeliver > 0} tone="warn">
                          {formatRateWithUnit(census.rates.redeliver)}
                        </Tone>,
                      ],
                      [
                        t("board.overview.rabbitmq.unroutable"),
                        <Tone key="unroutable" bad={census.rates.unroutable > 0} tone="err">
                          {formatRateWithUnit(census.rates.unroutable)}
                        </Tone>,
                      ],
                    ]}
                  />
                </Panel>
                <Panel style={CHART_CARD}>
                  <b style={{ fontSize: "12.5px" }}>{t("board.overview.rabbitmq.watermarks")}</b>
                  {nodes.map((node) => (
                    <NodeWatermarks key={node.name} node={node} />
                  ))}
                  {nodes.length === 0 && (
                    <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {t("board.overview.rabbitmq.noNodes")}
                    </span>
                  )}
                </Panel>
              </div>

              <Panel style={TABLE_CARD}>
                <PanelHeader title={t("board.overview.rabbitmq.busiest")} />
                <Table>
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
                          <TableCell>{queue.ref.name}</TableCell>
                          <TableCell className="mono3" style={NAME_CELL}>
                            {vhost(queue)}
                          </TableCell>
                          <TableCell>{queueType(queue)}</TableCell>
                          <TableCell
                            className="mono3"
                            style={{
                              textAlign: "right",
                              color: ready > 0 ? "var(--c-warn-text)" : undefined,
                            }}
                          >
                            {formatCount(ready)}
                          </TableCell>
                          <TableCell className="mono3" style={{ textAlign: "right" }}>
                            {formatCount(unacked)}
                          </TableCell>
                          <TableCell className="mono3" style={{ textAlign: "right" }}>
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

/** Colours a figure only when it is telling you something. */
function Tone({
  bad,
  tone,
  children,
}: {
  bad: boolean;
  tone: "warn" | "err";
  children: ReactNode;
}) {
  return <span style={bad ? { color: `var(--c-${tone}-text)` } : undefined}>{children}</span>;
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
    <>
      {memory != null && (
        <MeterRow
          label={`${node.name} mem`}
          value={memory}
          color={memoryAlarm(node) ? "var(--c-err)" : memory >= 80 ? "var(--c-warn)" : undefined}
        />
      )}
      {disk != null && (
        <MeterRow
          label={`${node.name} disk`}
          value={disk}
          display={formatBytes(node.attributes?.diskFree)}
          color={diskFreeAlarm(node) ? "var(--c-err)" : disk >= 80 ? "var(--c-warn)" : undefined}
        />
      )}
      {stranded.length > 0 && (
        <div style={{ fontSize: "10.5px", color: "var(--c-err-text)" }}>
          {t("board.overview.rabbitmq.partitionWarn", {
            node: node.name,
            peers: stranded.join(", "),
          })}
        </div>
      )}
    </>
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
