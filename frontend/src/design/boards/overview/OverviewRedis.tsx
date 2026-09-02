import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageBody } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MeterRow, Panel, PanelHeader, StatTile, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { CHART_CARD, CHART_ROW, KPI_GRID, OverviewHeader, TABLE_CARD } from "./_shared";
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

const MONO11 = { fontSize: "11px" } as const;
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
      <OverviewHeader subtitle={t("board.overview.redis.subtitle")} />
      <PageBody>
        <BoardState state={servers}>
          {node != null && (
            <>
              <div className={KPI_GRID}>
                <StatTile
                  label={t("board.common.mode")}
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
                  value={formatCount(streamRows.length)}
                  /* Found, not held: SCAN is a cursor and the walk is capped,
                     so this is what the listing saw. */
                  hint={t("board.overview.redis.found")}
                />
                <StatTile
                  label={t("board.common.consumerGroup")}
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
                  value={formatCount(owed)}
                  valueColor={owed > 0 ? "var(--c-warn-text)" : undefined}
                  hint={t("board.overview.redis.pelHint")}
                />
              </div>

              <div className={CHART_ROW}>
                <Panel style={CHART_CARD}>
                  <b style={{ fontSize: "12.5px" }}>{t("board.overview.redis.throughput")}</b>
                  {/* The instantaneous figures the server reports, not a
                      series. Nothing in this app records one for Redis, and a
                      chart drawn from a single reading would be a line through
                      one point. */}
                  <div style={{ display: "flex", gap: "26px", marginTop: "10px" }}>
                    <Figure
                      label={t("board.cluster.redis.ops")}
                      value={opsPerSec(node) == null ? "—" : formatCount(opsPerSec(node) ?? 0)}
                    />
                    <Figure
                      label={t("board.common.connections")}
                      value={
                        connectedClients(node) == null
                          ? "—"
                          : formatCount(connectedClients(node) ?? 0)
                      }
                    />
                    <Figure
                      label={t("board.cluster.redis.hitRate")}
                      value={hitRatePercent(node) == null ? "—" : `${hitRatePercent(node)}%`}
                    />
                  </div>
                </Panel>
                <Panel style={CHART_CARD}>
                  <b style={{ fontSize: "12.5px" }}>{t("board.cluster.redis.memory")}</b>
                  <div style={{ marginTop: "12px" }}>
                    {memoryPercent != null ? (
                      <MeterRow
                        label={`${formatBytes(usedMemoryBytes(node) ?? 0)} / ${formatBytes(maxMemoryBytes(node) ?? 0)}`}
                        value={memoryPercent}
                      />
                    ) : (
                      <div style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
                        {t("board.cluster.redis.memoryNoCap", {
                          used: formatBytes(usedMemoryBytes(node) ?? 0),
                        })}
                      </div>
                    )}
                  </div>
                </Panel>
              </div>

              <Panel style={TABLE_CARD}>
                <PanelHeader title={t("board.overview.redis.topLength")} />
                <BoardState
                  state={streams}
                  empty={
                    busiest.length === 0 ? (
                      <div style={{ padding: "16px", fontSize: "11.5px", color: "var(--c-muted)" }}>
                        {t("board.topics.redis.noStreams")}
                      </div>
                    ) : undefined
                  }
                >
                  <Table inset>
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
                          <TableCell className="mono3" style={MONO11}>
                            {streamKey(stream)}
                          </TableCell>
                          <TableCell className="mono3" style={RIGHT}>
                            {formatCount(length(stream))}
                          </TableCell>
                          <TableCell className="mono3" style={RIGHT}>
                            {groupCount(stream) === 0 ? (
                              <Status tone="off">{t("board.overview.redis.noGroup")}</Status>
                            ) : (
                              groupCount(stream)
                            )}
                          </TableCell>
                          <TableCell className="mono3" style={MONO11}>
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{label}</div>
      <div className="mono3" style={{ fontSize: "17px", fontWeight: 600, marginTop: "2px" }}>
        {value}
      </div>
    </div>
  );
}
