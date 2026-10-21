import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Inbox, Layers, MemoryStick, Server, Users } from "lucide-react";
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
import { KPI_GRID } from "./_shared";
import { useRedisGroups } from "@/hooks/redis/useRedisGroups";
import { useRedisServers } from "@/hooks/redis/useRedisNodes";
import { useRedisStreams } from "@/hooks/redis/useRedisStreams";
import { formatBytes, formatCount } from "@/lib/format";
import { groupCount, lastGeneratedId, length, streamKey } from "@/mq/redis/destinations";
import { health, pending } from "@/mq/redis/subscriptions";
import {
  connectedClients,
  formatUptime,
  hitRatePercent,
  maxMemoryBytes,
  memoryUsagePercent,
  mode,
  opsPerSec,
  uptimeSeconds,
  usedMemoryBytes,
} from "@/mq/redis/nodes";

const RIGHT = { textAlign: "right" } as const;

/** How many of the busiest streams the table shows. */
const TOP_STREAMS = 6;

/**
 * Board 11d — the Redis Stream overview.
 *
 * Every figure here is read rather than derived from a sample: the server's
 * own INFO for what it holds and how fast it is going, and the stream and
 * group lists for the counts. Those two are counts of what the scan found
 * rather than of what exists, which is why they say "found" - SCAN is a cursor
 * and the driver caps the walk.
 *
 * The canvas drew a command-rate chart. There is no series behind it: nothing
 * in this app records one for Redis, and the server reports an instantaneous
 * figure only - so the tile shows that figure and there is no chart.
 */
export function OverviewRedis() {
  const { t } = useTranslation();
  const servers = useRedisServers();
  const streams = useRedisStreams();
  const groups = useRedisGroups();

  const nodes = useMemo(
    () => (servers.data?.nodes ?? []).filter((node) => node != null),
    [servers.data],
  );
  const node = nodes[0] ?? null;

  const streamRows = useMemo(
    () => (streams.data ?? []).filter((stream) => stream != null),
    [streams.data],
  );
  const groupRows = useMemo(
    () => (groups.data ?? []).filter((group) => group != null),
    [groups.data],
  );

  const busiest = useMemo(
    () => [...streamRows].sort((left, right) => length(right) - length(left)).slice(0, TOP_STREAMS),
    [streamRows],
  );

  /* Summed from the group list rather than asked for separately: every group
     already carries what it is owed, and a per-group XPENDING would be one
     round trip each to answer a single tile. */
  const owed = useMemo(
    () => groupRows.reduce((total, group) => total + (pending(group) ?? 0), 0),
    [groupRows],
  );
  const stalled = useMemo(
    () => groupRows.filter((group) => health(group) === "stalled").length,
    [groupRows],
  );

  const memoryPercent = node == null ? null : memoryUsagePercent(node);

  return (
    <Page>
      <PageHeader
        title={t("board.common.overview")}
        subtitle={t("board.overview.redis.subtitle")}
        actions={
          <RefreshButton
            refreshing={servers.refreshing || streams.refreshing || groups.refreshing}
            online={servers.online}
            onClick={() => {
              void servers.refresh();
              void streams.refresh();
              void groups.refresh();
            }}
          />
        }
      />
      <PageBody>
        <BoardState state={servers}>
          {node != null && (
            <>
              <div className={KPI_GRID}>
                <StatTile
                  label={t("board.common.mode")}
                  icon={Server}
                  tone="slate"
                  value={mode(node) ?? "—"}
                  hint={
                    uptimeSeconds(node) == null
                      ? undefined
                      : t("board.overview.redis.uptime", {
                          uptime: formatUptime(uptimeSeconds(node) ?? 0),
                        })
                  }
                />
                <StatTile
                  label="Stream"
                  icon={Layers}
                  tone="violet"
                  value={formatCount(streamRows.length)}
                  /* Found, not held: SCAN is a cursor and the walk is capped,
                     so this is what the listing saw. */
                  hint={t("board.overview.redis.found")}
                />
                <StatTile
                  label={t("board.common.consumerGroup")}
                  icon={Users}
                  tone="teal"
                  value={formatCount(groupRows.length)}
                  hint={
                    stalled > 0
                      ? t("board.overview.redis.stalled", { count: stalled })
                      : t("board.overview.redis.allConsuming")
                  }
                  hintColor={stalled > 0 ? "var(--c-warn-text)" : undefined}
                />
                <StatTile
                  label={t("board.common.memory")}
                  icon={MemoryStick}
                  tone="pink"
                  value={formatBytes(usedMemoryBytes(node) ?? 0)}
                  hint={
                    maxMemoryBytes(node) == null
                      ? /* No maxmemory is no cap, which is not the same as a
                           cap this server happens to be under. */
                        t("board.overview.redis.noCap")
                      : `/ ${formatBytes(maxMemoryBytes(node) ?? 0)} · ${memoryPercent}%`
                  }
                />
                <StatTile
                  label={t("board.overview.redis.pel")}
                  icon={Inbox}
                  tone="orange"
                  value={formatCount(owed)}
                  valueColor={owed > 0 ? "var(--c-warn-text)" : undefined}
                  hint={t("board.overview.redis.pelHint")}
                />
              </div>

              <div className="mqs-tablerow">
                <Panel>
                  <PanelHeader title={t("board.overview.redis.throughput")} />
                  {/* The instantaneous figures the server reports, not a
                      series. Nothing in this app records one for Redis, and a
                      chart drawn from a single reading would be a line through
                      one point. */}
                  <div className="grid grid-cols-3 gap-2 p-4">
                    <MiniStat
                      label={t("board.cluster.redis.ops")}
                      value={opsPerSec(node) == null ? "—" : formatCount(opsPerSec(node) ?? 0)}
                    />
                    <MiniStat
                      label={t("board.common.connections")}
                      value={
                        connectedClients(node) == null
                          ? "—"
                          : formatCount(connectedClients(node) ?? 0)
                      }
                    />
                    <MiniStat
                      label={t("board.cluster.redis.hitRate")}
                      value={hitRatePercent(node) == null ? "—" : `${hitRatePercent(node)}%`}
                    />
                  </div>
                </Panel>
                <Panel>
                  <PanelHeader title={t("board.cluster.redis.memory")} />
                  <div className="p-4">
                    <div className="rounded-lg bg-(--c-fill-soft) px-3 py-2.5 ring-1 ring-(--c-rule) ring-inset">
                      {memoryPercent != null ? (
                        <MeterRow
                          label={`${formatBytes(usedMemoryBytes(node) ?? 0)} / ${formatBytes(maxMemoryBytes(node) ?? 0)}`}
                          labelWidth={120}
                          value={memoryPercent}
                        />
                      ) : (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t("board.cluster.redis.memoryNoCap", {
                            used: formatBytes(usedMemoryBytes(node) ?? 0),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </Panel>
              </div>

              <Panel className="overflow-hidden">
                <PanelHeader title={t("board.overview.redis.topLength")} />
                <BoardState
                  state={streams}
                  empty={
                    busiest.length === 0 ? (
                      <p className="p-4 text-xs text-muted-foreground">
                        {t("board.topics.redis.noStreams")}
                      </p>
                    ) : undefined
                  }
                >
                  <Table inset="card">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stream</TableHead>
                        <TableHead style={RIGHT}>XLEN</TableHead>
                        <TableHead style={RIGHT}>{t("board.common.group")}</TableHead>
                        <TableHead>last-generated-id</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {busiest.map((stream) => (
                        <TableRow key={streamKey(stream)}>
                          <TableCell className="mono3 text-xs">{streamKey(stream)}</TableCell>
                          <TableCell style={RIGHT}>{formatCount(length(stream))}</TableCell>
                          <TableCell style={RIGHT}>
                            {groupCount(stream) === 0 ? (
                              <Status tone="off">{t("board.overview.redis.noGroup")}</Status>
                            ) : (
                              groupCount(stream)
                            )}
                          </TableCell>
                          <TableCell className="mono3 text-xs text-muted-foreground">
                            {lastGeneratedId(stream) ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </BoardState>
              </Panel>
            </>
          )}
        </BoardState>
      </PageBody>
    </Page>
  );
}
