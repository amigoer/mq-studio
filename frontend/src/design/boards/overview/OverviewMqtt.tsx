import { useTranslation } from "react-i18next";
import { Activity, Cable, CircleSlash, Pin, Users } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MiniStat, Panel, PanelHeader, StatTile } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useMqttBroker } from "@/hooks/mqtt/useMqttBroker";
import { brokerStats, formatUptimeSeconds, sysTopics } from "@/mq/mqtt/cluster";
import { formatBytes, formatCount } from "@/lib/format";
import { KPI_GRID } from "./_shared";

/** A figure the broker did not report, drawn as absent rather than as zero. */
function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

function reportedBytes(value: number | null): string {
  return value == null ? "—" : formatBytes(value);
}

/**
 * Board 11e — MQTT overview.
 *
 * Every figure here comes from whichever tier this broker answered, and which
 * one that is decides what the page can show. A plain Mosquitto publishes a
 * full $SYS tree and no topic count, because MQTT cannot enumerate topics; a
 * default EMQX refuses the $SYS subscription and answers over its management
 * API, which does count them.
 *
 * That is why every tile reads through `reported`. A broker that does not
 * publish a counter leaves it absent, and "this broker does not count dropped
 * messages" is a different statement from "no messages were dropped" - only
 * one of them means anything is healthy.
 *
 * The canvas drew a client trend and a message-rate chart. Neither survives:
 * $SYS publishes running totals and load averages over one, five and fifteen
 * minutes, and no broker publishes a series. A chart would have been this
 * app's own samples drawn as the broker's history.
 */
export function OverviewMqtt() {
  const { t } = useTranslation();
  const state = useMqttBroker();

  const overview = state.data?.overview ?? null;
  const stats = overview != null ? brokerStats(overview) : null;
  const tree = overview != null ? sysTopics(overview) : [];

  return (
    <Page>
      <PageHeader
        title={t("board.common.overview")}
        subtitle={stats?.version ?? ""}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      <BoardState state={state}>
        <PageBody>
          <div className={KPI_GRID}>
            <StatTile
              label={t("board.overview.mqtt.onlineClients")}
              icon={Cable}
              tone="slate"
              value={reported(stats?.clientsConnected ?? null)}
              hint={
                stats?.clientsMaximum != null
                  ? t("board.overview.mqtt.peakClients", {
                      count: stats.clientsMaximum,
                    })
                  : undefined
              }
            />
            <StatTile
              label={t("board.overview.mqtt.subscriptions")}
              icon={Users}
              tone="teal"
              value={reported(stats?.subscriptions ?? null)}
              hint={
                stats?.sharedSubscriptions != null
                  ? t("board.overview.mqtt.shared", { count: stats.sharedSubscriptions })
                  : undefined
              }
            />
            <StatTile
              label={t("board.overview.mqtt.retained")}
              icon={Pin}
              tone="violet"
              value={reported(stats?.retained ?? null)}
              hint={t("board.overview.mqtt.retainedHint")}
            />
            <StatTile
              label={t("board.overview.mqtt.messagesIn")}
              icon={Activity}
              tone="blue"
              value={reported(stats?.messagesReceived ?? null)}
              hint={t("board.overview.mqtt.messagesOut", {
                count: stats?.messagesSent ?? 0,
              })}
            />
            <StatTile
              label={t("board.overview.mqtt.dropped")}
              icon={CircleSlash}
              tone="orange"
              value={reported(stats?.messagesDropped ?? null)}
              hint={t("board.overview.mqtt.droppedHint")}
            />
          </div>

          <Panel>
            <PanelHeader title={t("board.overview.mqtt.broker")} />
            <div className="grid grid-cols-3 gap-2 p-4">
              <MiniStat
                label={t("board.overview.mqtt.uptime")}
                value={formatUptimeSeconds(stats?.uptimeSeconds ?? null)}
              />
              {/* MQTT cannot enumerate topics; only a management API can
                  count them, so this is blank on a plain broker. */}
              <MiniStat label={t("board.overview.mqtt.topics")} value={reported(stats?.topics ?? null)} />
              <MiniStat
                label={t("board.overview.mqtt.sessions")}
                value={reported(stats?.clientsTotal ?? null)}
              />
              <MiniStat
                label={t("board.overview.mqtt.bytesIn")}
                value={reportedBytes(stats?.bytesReceived ?? null)}
              />
              <MiniStat
                label={t("board.overview.mqtt.bytesOut")}
                value={reportedBytes(stats?.bytesSent ?? null)}
              />
              <MiniStat label={t("board.overview.mqtt.heap")} value={reportedBytes(stats?.heapBytes ?? null)} />
            </div>
          </Panel>

          {/*
            The broker's own tree, verbatim.

            Curating it would make the page less useful than
            `mosquitto_sub -t '$SYS/#'`: a broker publishes counters this app
            has never heard of, and the ones it does know are already above.
          */}
          <Panel className="overflow-hidden">
            <PanelHeader
              title={t("board.overview.mqtt.sysMetrics")}
              action={
                <span className="text-xs text-muted-foreground">
                  {tree.length > 0
                    ? t("board.overview.mqtt.sysCount", { count: tree.length })
                    : t("board.overview.mqtt.sysAbsent")}
                </span>
              }
            />
            {tree.length > 0 && (
              <Table inset="card">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.common.metrics")}</TableHead>
                    <TableHead style={{ textAlign: "right" }}>{t("board.common.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tree.map((entry) => (
                    <TableRow key={entry.topic}>
                      <TableCell className="mono3 text-xs">{entry.topic}</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {entry.value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </PageBody>
      </BoardState>
    </Page>
  );
}
