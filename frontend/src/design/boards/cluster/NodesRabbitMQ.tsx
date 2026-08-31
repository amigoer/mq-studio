import { useMemo, useState } from "react";
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
import { KV, MeterRow, Panel, PanelHeader, Segmented, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRabbitCluster } from "@/hooks/rabbitmq/useRabbitCluster";
import { formatBytes, formatCount } from "@/lib/format";
import {
  diskFree,
  diskFreeAlarm,
  diskFreeLimit,
  diskHeadroomUsage,
  erlangProcessLimit,
  erlangProcesses,
  fileDescriptorLimit,
  fileDescriptorsUsed,
  memoryAlarm,
  memoryLimit,
  memoryUsage,
  memoryUsed,
  nodeType,
  partitions,
  runQueue,
  schedulers,
  uptimeMs,
} from "@/mq/rabbitmq/nodes";
import type { Node } from "@/api/models";
import type { DeprecatedFeature, FeatureFlag, HealthCheck } from "@/api/rabbitmq";

const MONO11 = { fontSize: "11px" } as const;

type Tab = "nodes" | "health" | "flags";

/**
 * Board 4d - RabbitMQ nodes.
 *
 * The canvas drew three nodes with memory and disk percentages, a plugin list
 * and an HA policy. Two of those are gone: the disk figure was a usage
 * percentage the broker never reports, and the plugin list has no endpoint at
 * all in the management API.
 *
 * What replaced them is what RabbitMQ does answer, and it answers more than
 * the canvas asked. The broker runs its own health checks and says which
 * failed and why; it lists the feature flags a rolling upgrade depends on; and
 * it names the features this cluster still uses that a later release will
 * refuse. None of that has a counterpart in another family, and none of it is
 * guesswork from metrics.
 */
export function NodesRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitCluster();
  const [tab, setTab] = useState<Tab>("nodes");

  const nodes = useMemo(() => state.data?.nodes ?? [], [state.data]);
  const census = state.data?.census ?? null;
  const health = state.data?.health ?? null;

  const alarms = health?.alarms ?? [];
  const split = nodes.filter((node) => partitions(node).length > 0);
  const failing = (health?.checks ?? []).filter(
    (check) => !check.passed && !check.unavailable,
  ).length;

  return (
    <Page>
      <PageHeader
        title={t("board.common.node")}
        subtitle={
          census != null
            ? t("board.cluster.rabbitmq.subtitle", {
                cluster: census.clusterName,
                version: census.version,
                erlang: census.runtimeVersion,
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
        <BoardState
          state={state}
          empty={nodes.length === 0 ? t("board.cluster.rabbitmq.noNodes") : undefined}
        >
          {/* A partition outranks everything else this page has to say: the
              cluster is running as two halves that each believe they are
              whole, and every figure below is one half's view. */}
          {split.length > 0 && (
            <Panel
              style={{
                padding: "10px 14px",
                borderColor: "var(--c-err)",
                fontSize: "11.5px",
                color: "var(--c-err-text)",
              }}
            >
              {t("board.cluster.rabbitmq.partitionBanner", {
                nodes: split.map((node) => node.name).join(", "),
              })}
            </Panel>
          )}
          {alarms.length > 0 && (
            <Panel
              style={{
                padding: "10px 14px",
                borderColor: "var(--c-warn)",
                fontSize: "11.5px",
                color: "var(--c-warn-text)",
              }}
            >
              {t("board.cluster.rabbitmq.alarmBanner", {
                alarms: alarms.map((alarm) => `${alarm.node} ${alarm.resource}`).join(" · "),
              })}
            </Panel>
          )}

          <Segmented
            value={tab}
            onChange={(next: Tab) => setTab(next)}
            options={[
              { value: "nodes", label: t("board.cluster.rabbitmq.tabNodes") },
              {
                value: "health",
                label:
                  failing > 0
                    ? t("board.cluster.rabbitmq.tabHealthFailing", { count: failing })
                    : t("board.cluster.rabbitmq.tabHealth"),
              },
              { value: "flags", label: t("board.cluster.rabbitmq.tabFlags") },
            ]}
          />

          {tab === "nodes" && <NodeList nodes={nodes} />}
          {tab === "health" && <HealthList checks={health?.checks ?? []} />}
          {tab === "flags" && (
            <FlagList
              flags={health?.featureFlags ?? []}
              deprecated={health?.deprecatedFeatures ?? []}
            />
          )}
        </BoardState>
      </PageBody>
    </Page>
  );
}

function NodeList({ nodes }: { nodes: Node[] }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {nodes.map((node) => (
        <NodeCard key={node.name} node={node} />
      ))}
      {nodes.length === 0 && (
        <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
          {t("board.cluster.rabbitmq.noNodes")}
        </span>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: Node }) {
  const { t } = useTranslation();
  const memory = memoryUsage(node);
  const disk = diskHeadroomUsage(node);
  const stranded = partitions(node);
  const processes = erlangProcesses(node);
  const processLimit = erlangProcessLimit(node);
  const descriptors = fileDescriptorsUsed(node);
  const descriptorLimit = fileDescriptorLimit(node);

  return (
    <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <PanelHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span className="mono3">{node.name}</span>
            <Status tone={toneOf(node)}>{node.status}</Status>
            {nodeType(node) !== "" && (
              <span style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                {nodeType(node)}
              </span>
            )}
          </span>
        }
      />

      {/* Memory is a real fraction of the watermark that blocks publishers.
          Disk is headroom against the alarm floor, because RabbitMQ never
          reports the size of the disk - there is no usage to compute. */}
      {memory != null && (
        <MeterRow
          label="memory"
          value={memory}
          display={`${formatBytes(memoryUsed(node))} / ${formatBytes(memoryLimit(node))}`}
          color={memoryAlarm(node) ? "var(--c-err)" : memory >= 80 ? "var(--c-warn)" : undefined}
        />
      )}
      {disk != null && (
        <MeterRow
          label="disk free"
          value={disk}
          display={`${formatBytes(diskFree(node))} · floor ${formatBytes(diskFreeLimit(node))}`}
          color={diskFreeAlarm(node) ? "var(--c-err)" : disk >= 80 ? "var(--c-warn)" : undefined}
        />
      )}

      <KV
        rows={[
          [t("board.cluster.rabbitmq.uptime"), formatUptime(uptimeMs(node))],
          [t("board.cluster.rabbitmq.schedulers"), formatCount(schedulers(node))],
          [
            t("board.cluster.rabbitmq.erlangProcesses"),
            processLimit > 0
              ? `${formatCount(processes)} / ${formatCount(processLimit)}`
              : formatCount(processes),
          ],
          [
            t("board.cluster.rabbitmq.fileDescriptors"),
            descriptorLimit > 0
              ? `${formatCount(descriptors)} / ${formatCount(descriptorLimit)}`
              : formatCount(descriptors),
          ],
          /* A run queue that stays above the scheduler count means the node is
             CPU-bound, which no other figure on this card would show. */
          [t("board.cluster.rabbitmq.runQueue"), formatCount(runQueue(node))],
        ]}
      />

      {stranded.length > 0 && (
        <span style={{ fontSize: "11px", color: "var(--c-err-text)" }}>
          {t("board.cluster.rabbitmq.partitionedFrom", { peers: stranded.join(", ") })}
        </span>
      )}
    </Panel>
  );
}

function toneOf(node: Node): "ok" | "warn" | "err" {
  if (node.status === "offline") return "err";
  if (node.status === "warning") return "warn";
  return "ok";
}

/**
 * The broker's own checks.
 *
 * A check the broker cannot run is not a failure. It means the endpoint is not
 * on this version, or needs a plugin that is not installed, and showing it in
 * red would have an operator chasing a problem that is not there.
 */
function HealthList({ checks }: { checks: HealthCheck[] }) {
  const { t } = useTranslation();
  if (checks.length === 0) {
    return (
      <Panel style={{ padding: "12px 16px", fontSize: "11.5px", color: "var(--c-muted)" }}>
        {t("board.cluster.rabbitmq.noHealth")}
      </Panel>
    );
  }
  return (
    <Panel style={{ padding: "4px 0" }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("board.cluster.rabbitmq.check")}</TableHead>
            <TableHead>{t("board.common.status")}</TableHead>
            <TableHead>{t("board.common.reason")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.map((check) => (
            <TableRow key={check.id}>
              <TableCell>{t(`board.cluster.rabbitmq.checks.${check.id}`)}</TableCell>
              <TableCell>
                {check.unavailable ? (
                  <Status tone="off">{t("board.cluster.rabbitmq.checkUnavailable")}</Status>
                ) : check.passed ? (
                  <Status tone="ok">{t("board.cluster.rabbitmq.checkPassed")}</Status>
                ) : (
                  <Status tone="err">{t("board.cluster.rabbitmq.checkFailed")}</Status>
                )}
              </TableCell>
              <TableCell style={{ color: "var(--c-muted)" }}>{check.reason || "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * Feature flags and deprecations.
 *
 * They share a tab because they are the same question from two directions:
 * what this cluster has turned on that it cannot turn off again, and what it
 * still relies on that a later release will refuse. Both decide whether an
 * upgrade is safe.
 */
function FlagList({
  flags,
  deprecated,
}: {
  flags: FeatureFlag[];
  deprecated: DeprecatedFeature[];
}) {
  const { t } = useTranslation();
  const disabled = flags.filter((flag) => flag.state !== "enabled");
  /* In use is the work item; the rest is background, so it leads. */
  const inUse = deprecated.filter((feature) => feature.inUse);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {inUse.length > 0 && (
        <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <PanelHeader title={t("board.cluster.rabbitmq.deprecatedInUse")} />
          {inUse.map((feature) => (
            <div key={feature.name} style={{ fontSize: "11.5px" }}>
              <span className="mono3" style={MONO11}>
                {feature.name}
              </span>{" "}
              <Status tone={feature.phase === "removed" ? "err" : "warn"}>
                {t(`board.cluster.rabbitmq.phases.${feature.phase}`, feature.phase)}
              </Status>
              {feature.description !== "" && (
                <div style={{ color: "var(--c-muted)" }}>{feature.description}</div>
              )}
            </div>
          ))}
        </Panel>
      )}

      <Panel style={{ padding: "4px 0" }}>
        <PanelHeader
          title={t("board.cluster.rabbitmq.featureFlags", {
            total: flags.length,
            disabled: disabled.length,
          })}
          style={{ padding: "8px 16px 0" }}
        />
        {flags.length === 0 ? (
          <div style={{ padding: "8px 16px 12px", fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.cluster.rabbitmq.noFlags")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.cluster.rabbitmq.flag")}</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
                <TableHead>{t("board.cluster.rabbitmq.stability")}</TableHead>
                <TableHead>{t("board.cluster.rabbitmq.providedBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={flag.name}>
                  <TableCell className="mono3" style={MONO11}>
                    {flag.name}
                  </TableCell>
                  <TableCell>
                    <Status tone={flag.state === "enabled" ? "ok" : "warn"}>{flag.state}</Status>
                  </TableCell>
                  <TableCell>{flag.stability}</TableCell>
                  <TableCell>{flag.providedBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

/** The broker reports uptime in milliseconds, which nobody reads as a number. */
function formatUptime(milliseconds: number): string {
  if (milliseconds <= 0) return "-";
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
