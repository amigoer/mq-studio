import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Panel,
  Status,
} from "@/components";
import { useCluster } from "@/hooks/useCluster";
import { useBrokerData } from "@/hooks/useBrokerData";
import * as clusterApi from "@/api/cluster";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { ConfigDialog } from "./ConfigDialog";
import { MaintenanceDialog } from "./MaintenanceDialog";
import { ReplicaDialog } from "./ReplicaDialog";
import {
  BrokerRole,
  brokerId,
  brokerName,
  commitLogDiskUsage,
  consumeQueueDiskUsage,
  groupCount,
  msgInToday,
  msgOutToday,
  role,
  topicCount,
} from "@/mq/rocketmq/nodes";
import type { Node } from "@/api/models";
import { Metric, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** RocketMQ reports -1 where a broker did not answer; nothing invents a zero. */
const UNKNOWN = -1;

function metric(value: number): string {
  return value === UNKNOWN ? "—" : value.toLocaleString();
}

function rate(value: number): string {
  return value === UNKNOWN ? "—" : `${value.toLocaleString()}/s`;
}

/** The canvas amber: a broker past its watermark colours its own meter. */
function diskColor(percent: number): { color?: string; labelColor?: string } {
  if (percent >= 85) return { color: "var(--c-warn)", labelColor: "var(--c-warn-text)" };
  return {};
}

/**
 * Board 3f — RocketMQ brokers.
 *
 * The canvas also drew a NameServer table with round-trip, flush mode and
 * CommitLog latency columns. The admin protocol reports none of those - the
 * NameServer list is just the addresses the profile was dialled with - so the
 * table is a broker runtime table instead, carrying the figures the brokers do
 * report. PageCache latency, uptime and slave sync lag are gone for the same
 * reason.
 */
export function ClusterRocketMQ() {
  const { t } = useTranslation();
  const state = useCluster();
  const nodes = state.data?.nodes ?? [];
  const directory = state.data?.directory ?? [];

  const masters = nodes.filter((node) => role(node) === BrokerRole.Master);
  const slaves = nodes.filter((node) => role(node) === BrokerRole.Slave);
  const version = nodes.find((node) => node.version !== "")?.version ?? "";
  const overview = state.data?.cluster?.overview;

  /*
   * A settings document is a few hundred keys and one request, so both of
   * these wait for the dialog that shows them and neither of them polls.
   */
  const [configOf, setConfigOf] = useState<string | null>(null);
  const [directoryConfigOpen, setDirectoryConfigOpen] = useState(false);
  const [maintenanceOf, setMaintenanceOf] = useState<string | null>(null);
  const [replicasOf, setReplicasOf] = useState<string | null>(null);

  const loadNodeConfig = useCallback(
    (id: number) => clusterApi.getNodeConfig(id, configOf ?? ""),
    [configOf],
  );
  const nodeConfig = useBrokerData(loadNodeConfig, {
    refreshMs: null,
    enabled: configOf != null,
  });

  const loadDirectoryConfig = useCallback(
    (id: number) => clusterApi.getDirectoryConfig(id),
    [],
  );
  const directoryConfig = useBrokerData(loadDirectoryConfig, {
    refreshMs: null,
    enabled: directoryConfigOpen,
  });

  return (
    <Page>
      <PageHeader
        title={t("board.cluster.rocketmq.liveTitle", {
          cluster: overview?.name || t("board.cluster.rocketmq.title"),
        })}
        subtitle={t(
          version === ""
            ? "board.cluster.rocketmq.liveSubtitleNoVersion"
            : "board.cluster.rocketmq.liveSubtitle",
          { version, masters: masters.length, slaves: slaves.length },
        )}
        actions={
          <Button variant="outline" disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
            {state.refreshing && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
            {t("board.common.refresh")}
          </Button>
        }
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : nodes.length === 0 ? (
        <Notice title={t("board.cluster.rocketmq.noBrokers")} />
      ) : (
        <PageBody style={{ gap: "12px" }}>
          <div className={NODE_GRID}>
            {nodes.map((node) => (
              <BrokerTile key={`${brokerName(node)}-${brokerId(node)}`} node={node} />
            ))}
          </div>
          {directory.length > 0 && (
            <DirectoryPanel nodes={directory} onConfig={() => setDirectoryConfigOpen(true)} />
          )}
          <Panel style={TABLE_CARD}>
            <div
              style={{
                padding: "11px 16px",
                borderBottom: "1px solid var(--c-border)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <b style={{ fontSize: "12.5px" }}>{t("board.cluster.rocketmq.runtime")}</b>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.address")}</TableHead>
                  <TableHead>{t("board.common.role")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.topics")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.groups")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.todayIn")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.todayOut")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.consumeQueue")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={`row-${brokerName(node)}-${brokerId(node)}`}>
                    <TableCell className="mono3" style={MONO11}>
                      {node.address}
                    </TableCell>
                    <TableCell>{role(node)}</TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {metric(topicCount(node))}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {metric(groupCount(node))}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {metric(msgInToday(node))}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {metric(msgOutToday(node))}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {consumeQueueDiskUsage(node) === UNKNOWN
                        ? "—"
                        : `${consumeQueueDiskUsage(node)}%`}
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label={t("board.common.actions")}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setReplicasOf(node.address)}>
                            {t("board.cluster.rocketmq.replicas.action")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConfigOf(node.address)}>
                            {t("board.cluster.rocketmq.config.action")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setMaintenanceOf(node.address)}>
                            {t("board.cluster.rocketmq.maintenance.action")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </PageBody>
      )}

      <ConfigDialog
        open={configOf != null}
        title={t("board.cluster.rocketmq.config.brokerTitle")}
        subtitle={configOf ?? undefined}
        state={nodeConfig}
        onClose={() => setConfigOf(null)}
      />
      <ConfigDialog
        open={directoryConfigOpen}
        title={t("board.cluster.rocketmq.config.directoryTitle")}
        subtitle={directory.map((node) => node.address).join("  ")}
        state={directoryConfig}
        onClose={() => setDirectoryConfigOpen(false)}
      />
      <MaintenanceDialog
        open={maintenanceOf != null}
        address={maintenanceOf}
        onClose={() => setMaintenanceOf(null)}
      />
      <ReplicaDialog
        open={replicasOf != null}
        address={replicasOf}
        onClose={() => setReplicasOf(null)}
      />
    </Page>
  );
}

/**
 * The name servers this connection reaches the cluster through.
 *
 * Addresses and nothing else, because that is all there is: the admin protocol
 * has no call that asks a name server about itself, so there is no version, no
 * uptime and no per-address health to draw. The canvas drew round-trip and
 * flush-mode columns here; they were never available.
 */
function DirectoryPanel({
  nodes,
  onConfig,
}: {
  nodes: readonly Node[];
  onConfig: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Panel style={{ padding: "9px 10px 9px 16px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <b style={{ fontSize: "12.5px" }}>{t("board.cluster.rocketmq.directory")}</b>
      <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
        {t("board.cluster.rocketmq.directoryHint")}
      </span>
      <span className="flex-1" />
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {nodes.map((node) => (
          <span key={node.address} className="mono3" style={{ fontSize: "11px", color: "var(--c-fg-2)" }}>
            {node.address}
          </span>
        ))}
      </div>
      <Button variant="ghost" size="xs" onClick={onConfig}>
        {t("board.cluster.rocketmq.config.action")}
      </Button>
    </Panel>
  );
}

function BrokerTile({ node }: { node: Node }) {
  const { t } = useTranslation();
  const isSlave = role(node) === BrokerRole.Slave;
  const disk = commitLogDiskUsage(node);
  const label = `${brokerName(node)}${brokerId(node) !== 0 ? `-${brokerId(node)}` : ""}`;

  return (
    <NodeCard
      dim={isSlave}
      name={label}
      badges={
        <>
          <Status tone={node.status === "online" ? "ok" : "off"} style={TAG}>
            {role(node)}
          </Status>
          {disk !== UNKNOWN && disk >= 85 && (
            <Status tone="warn" style={TAG}>
              {t("board.cluster.rocketmq.diskAlert")}
            </Status>
          )}
        </>
      }
      address={node.address}
      metrics={
        <>
          <Metric label={t("board.common.in")} value={rate(node.rateIn)} />
          <Metric label={t("board.common.out")} value={rate(node.rateOut)} />
        </>
      }
      meters={
        disk === UNKNOWN
          ? []
          : [
              {
                label: t("board.cluster.rocketmq.disk", { percent: disk }),
                value: disk,
                ...(isSlave ? { color: "var(--c-muted-2)" } : diskColor(disk)),
              },
            ]
      }
    />
  );
}
