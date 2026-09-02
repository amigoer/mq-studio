import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Node } from "@/api/models";
import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
  KV,
  MeterRow,
  Panel,
  PanelHeader,
  SectionLabel,
  SelectField,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRedisServers, useRedisSlowLog } from "@/hooks/redis/useRedisNodes";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as clusterApi from "@/api/cluster";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import {
  TOTAL_SLOTS,
  appendOnlyEnabled,
  assignedSlots,
  changesSinceLastSave,
  clusterNodeId,
  clusterState,
  connectedClients,
  connectedReplicas,
  formatUptime,
  hitRatePercent,
  maxMemoryBytes,
  memoryFragmentation,
  memoryUsagePercent,
  mode,
  nodeAddress,
  nodeVersion,
  opsPerSec,
  ownedSlots,
  persistenceHealthy,
  role,
  slotsIncomplete,
  uptimeSeconds,
  usedMemoryBytes,
} from "@/mq/redis/nodes";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/** The two housekeeping jobs Redis has. Both are additive: neither loses data. */
const TASKS = ["snapshot", "rewriteAppendLog"] as const;

/** A figure the server did not report reads as a dash, never as a zero. */
function Figure({ value, render }: { value: number | null; render?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{render ? render(value) : formatCount(value)}</>;
}

/**
 * The two rows that only mean something on a cluster.
 *
 * Split out because a KV row is a fixed pair and a conditional spread of them
 * loses that shape, which the compiler is right to refuse.
 */
function clusterRows(
  node: Node,
  t: (key: string) => string,
): [ReactNode, ReactNode][] {
  if (clusterNodeId(node) == null) return [];
  return [
    [
      t("board.cluster.redis.nodeId"),
      <span className="mono3" style={MONO11}>
        {clusterNodeId(node)}
      </span>,
    ],
    [
      t("board.cluster.redis.slots"),
      <span className="mono3" style={MONO11}>
        {ownedSlots(node) ?? t("board.cluster.redis.noSlots")}
      </span>,
    ],
  ];
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{label}</div>
      <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Board 16d — the Redis server.
 *
 * Singular on a standalone connection and a list on a cluster, because that is
 * what is behind the connection in each case: a standalone server's replicas
 * are its followers rather than its peers, and the questions this page answers
 * - what is in memory, what has been slow, whether the data is being written
 * down - are all about the server being talked to.
 *
 * Two figures every other family's node page carries are missing on purpose.
 * Redis counts commands rather than messages, so there is no message rate; and
 * it reports memory rather than disk, so there is no disk meter. Both appear
 * under their own names instead of borrowed ones.
 */
export function NodeRedis() {
  const { t } = useTranslation();
  const state = useRedisServers();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);

  /* A Go slice of pointers types as (Node | null)[], so the nulls are dropped
     once here rather than guarded at every use. */
  const nodes = useMemo(
    () => (state.data?.nodes ?? []).filter((node): node is Node => node != null),
    [state.data],
  );
  const overview = state.data?.overview ?? null;

  useEffect(() => {
    const first = nodes[0];
    if (selected == null && first != null) setSelected(nodeAddress(first));
  }, [nodes, selected]);

  const node = useMemo(
    () => nodes.find((candidate) => nodeAddress(candidate) === selected) ?? nodes[0] ?? null,
    [nodes, selected],
  );
  const slowLog = useRedisSlowLog(node == null ? null : nodeAddress(node));

  const run = useCallback(
    async (task: string) => {
      if (node == null) return;
      const ok = await confirm({
        title: t(`board.cluster.redis.task.${task}Title`),
        /* Neither of these loses anything - a snapshot writes the dataset down
           and a rewrite compacts the append-only file - so the confirmation
           says what it costs rather than what it destroys. */
        description: t(`board.cluster.redis.task.${task}Hint`),
        confirmLabel: t("board.cluster.redis.task.run"),
      });
      if (!ok) return;
      try {
        await clusterApi.runMaintenance(connID, nodeAddress(node), task);
        /* The command returns as soon as the child process starts, so this is
           "it began" rather than "it finished". The status underneath is where
           the outcome actually appears. */
        toast.success(t("board.cluster.redis.task.started"));
        await state.refresh();
      } catch (taskError) {
        toast.error(t("board.cluster.redis.task.failed"), {
          description: formatErrorMessage(taskError),
        });
      }
    },
    [confirm, connID, node, state, t],
  );

  const healthy = node == null ? null : persistenceHealthy(node);
  const memoryPercent = node == null ? null : memoryUsagePercent(node);

  return (
    <Page>
      <PageHeader
        title={nodes.length > 1 ? t("board.cluster.redis.nodes") : t("board.common.node")}
        subtitle={t("board.cluster.redis.subtitle")}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />

      {nodes.length > 1 && (
        <Toolbar>
          <SelectField
            value={selected ?? ""}
            options={nodes.map((candidate) => ({
              value: nodeAddress(candidate),
              label: `${nodeAddress(candidate)} · ${role(candidate) ?? "?"}`,
            }))}
            onValueChange={setSelected}
          />
          <span className="flex-1" />
          {/* Every node can be online while a slot range belongs to none of
              them, and then the cluster cannot serve those keys. Nothing in
              the node list says so. */}
          {overview != null && slotsIncomplete(overview) && (
            <Status tone="warn">
              {t("board.cluster.redis.slotsMissing", {
                assigned: assignedSlots(overview) ?? 0,
                total: TOTAL_SLOTS,
              })}
            </Status>
          )}
          {overview != null && clusterState(overview) != null && (
            <Status tone={clusterState(overview) === "ok" ? "ok" : "warn"}>
              cluster_state: {clusterState(overview)}
            </Status>
          )}
        </Toolbar>
      )}

      <BoardState state={state}>
        <PageBody>
          {node != null && (
            <>
              <Panel style={{ padding: "12px 16px" }}>
                <PanelHeader
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      <span className="mono3">{nodeAddress(node)}</span>
                      <Status tone={role(node) === "master" ? "ok" : "off"}>
                        {role(node) ?? "?"}
                      </Status>
                      {mode(node) != null && <Status tone="off">{mode(node)}</Status>}
                      {nodeVersion(node) != null && <Status tone="off">v{nodeVersion(node)}</Status>}
                    </span>
                  }
                />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "10px",
                    marginTop: "10px",
                  }}
                >
                  <Stat
                    label={t("board.cluster.redis.ops")}
                    value={<Figure value={opsPerSec(node)} />}
                  />
                  <Stat
                    label={t("board.common.connections")}
                    value={<Figure value={connectedClients(node)} />}
                  />
                  <Stat
                    label={t("board.cluster.redis.hitRate")}
                    value={<Figure value={hitRatePercent(node)} render={(v) => `${v}%`} />}
                  />
                  <Stat
                    label={t("board.cluster.redis.uptime")}
                    value={<Figure value={uptimeSeconds(node)} render={formatUptime} />}
                  />
                </div>

                <div style={{ marginTop: "12px" }}>
                  {/* Memory, not disk. Redis reports no disk figure at all, and
                      a server with no cap is not a server that is full - so
                      with no maxmemory there is no meter to draw. */}
                  {memoryPercent != null ? (
                    <MeterRow
                      label={`${t("board.cluster.redis.memory")} · ${formatBytes(usedMemoryBytes(node) ?? 0)} / ${formatBytes(maxMemoryBytes(node) ?? 0)}`}
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

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  marginTop: "10px",
                }}
              >
                <Panel style={{ padding: "12px 16px" }}>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.common.persistence")}
                  </SectionLabel>
                  <KV
                    rows={[
                      [
                        "AOF",
                        appendOnlyEnabled(node)
                          ? t("board.cluster.redis.aofOn")
                          : t("board.cluster.redis.aofOff"),
                      ],
                      [
                        t("board.cluster.redis.unsavedChanges"),
                        <Figure value={changesSinceLastSave(node)} />,
                      ],
                      [
                        t("board.cluster.redis.lastResult"),
                        healthy == null ? (
                          /* Never run is not the same as run and failed, and
                             the difference is whether anyone needs to act. */
                          <span style={{ color: "var(--c-muted-2)" }}>
                            {t("board.cluster.redis.neverRun")}
                          </span>
                        ) : (
                          <Status tone={healthy ? "ok" : "warn"}>
                            {healthy ? "ok" : t("board.cluster.redis.saveFailed")}
                          </Status>
                        ),
                      ],
                      [t("board.cluster.redis.replicas"), <Figure value={connectedReplicas(node)} />],
                      [
                        t("board.cluster.redis.fragmentation"),
                        <Figure value={memoryFragmentation(node)} render={(v) => v.toFixed(2)} />,
                      ],
                      ...clusterRows(node, t),
                    ]}
                  />
                  <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                    {TASKS.map((task) => (
                      <Button key={task} variant="outline" size="xs" onClick={() => void run(task)}>
                        {t(`board.cluster.redis.task.${task}`)}
                      </Button>
                    ))}
                  </div>
                </Panel>

                <Panel style={{ padding: "12px 16px" }}>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.cluster.redis.slowlog")}
                  </SectionLabel>
                  <BoardState
                    state={slowLog}
                    empty={
                      (slowLog.data ?? []).length === 0 ? (
                        <div style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
                          {t("board.cluster.redis.slowlogEmpty")}
                        </div>
                      ) : undefined
                    }
                  >
                    <Table inset>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("board.cluster.redis.command")}</TableHead>
                          <TableHead style={RIGHT}>{t("board.cluster.redis.elapsed")}</TableHead>
                          <TableHead>{t("board.common.client")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(slowLog.data ?? []).map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="mono3" style={MONO11}>
                              {entry.command.join(" ")}
                            </TableCell>
                            <TableCell className="mono3" style={RIGHT}>
                              {/* Microseconds, because the threshold that
                                  captured the entry is set in them and
                                  rounding to milliseconds puts most at zero. */}
                              {formatCount(entry.durationMicros)}µs
                            </TableCell>
                            <TableCell className="mono3" style={MONO11}>
                              {entry.clientName !== "" ? entry.clientName : entry.clientAddress}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </BoardState>
                </Panel>
              </div>
            </>
          )}
        </PageBody>
      </BoardState>
    </Page>
  );
}
