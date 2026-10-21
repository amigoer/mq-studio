import { useTranslation } from "react-i18next";
import { Layers, Rows3, Server, ShieldAlert, Users } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MiniStat, Panel, PanelHeader, StatTile, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useKafkaCluster } from "@/hooks/kafka/useKafkaCluster";
import { formatCount } from "@/lib/format";
import {
  clusterID,
  consumerGroupCount,
  controllerNode,
  internalTopicCount,
  isController,
  leaderlessPartitions,
  nodeID,
  offlinePartitions,
  partitionCount,
  partitionsAreHealthy,
  rack,
  topicCount,
  underReplicatedPartitions,
} from "@/mq/kafka/cluster";
import { KPI_GRID } from "./_shared";

/** A count the cluster did not report, drawn as absent rather than as zero. */
function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 3b — Kafka overview.
 *
 * The canvas drew a throughput chart, a produce/consume rate pair and a total
 * backlog. None of them survives, because Kafka's admin protocol reports no
 * rate at all - produce and consume rates are JMX metrics, and this app speaks
 * the Kafka protocol rather than JMX. A backlog is not a cluster figure
 * either: it belongs to a consumer group against a topic, so a cluster total
 * would be a sum over every group and every partition, and one topic read by
 * five groups would count five times.
 *
 * What replaces them is what Kafka actually reports, and it is a better page
 * for it: partition health. Under-replicated, offline and leaderless are three
 * different degrees of trouble, and together they are the whole answer to "is
 * this cluster all right".
 */
export function OverviewKafka() {
  const { t } = useTranslation();
  const state = useKafkaCluster();

  const overview = state.data?.overview ?? null;
  const nodes = state.data?.nodes ?? [];

  const underReplicated = overview ? underReplicatedPartitions(overview) : null;
  const offline = overview ? offlinePartitions(overview) : null;
  const leaderless = overview ? leaderlessPartitions(overview) : null;
  const healthy = overview != null && partitionsAreHealthy(overview);
  const internal = overview ? internalTopicCount(overview) : null;

  return (
    <Page>
      <PageHeader
        title={t("board.common.overview")}
        subtitle={overview != null ? clusterID(overview) : ""}
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
              label="Broker"
              icon={Server}
              tone="slate"
              value={reported(nodes.length === 0 ? null : nodes.length)}
              hint={
                overview != null && controllerNode(overview) !== ""
                  ? t("board.overview.kafka.controllerIs", { id: controllerNode(overview) })
                  : t("board.overview.kafka.noController")
              }
            />
            <StatTile
              label="Topic"
              icon={Layers}
              tone="violet"
              value={reported(overview ? topicCount(overview) : null)}
              hint={
                internal == null
                  ? ""
                  : t("board.overview.kafka.internalHidden", { count: internal })
              }
            />
            <StatTile
              label={t("board.common.partition")}
              icon={Rows3}
              tone="blue"
              value={reported(overview ? partitionCount(overview) : null)}
              hint={t("board.overview.kafka.acrossAllTopics")}
            />
            <StatTile
              label={t("board.common.consumerGroup")}
              icon={Users}
              tone="teal"
              value={reported(overview ? consumerGroupCount(overview) : null)}
              hint={t("board.overview.kafka.groupsHint")}
            />
            <StatTile
              label={t("board.overview.kafka.underReplicated")}
              icon={ShieldAlert}
              tone="orange"
              value={reported(underReplicated)}
              valueColor={underReplicated ? "var(--c-warn-text)" : undefined}
              hint={t("board.overview.kafka.underReplicatedHint")}
            />
          </div>

          <div className="mqs-tablerow">
            <Panel>
              <PanelHeader
                title={t("board.overview.kafka.partitionHealth")}
                action={
                  healthy ? (
                    <Status tone="ok">{t("board.overview.kafka.allInSync")}</Status>
                  ) : (
                    <Status tone="warn">{t("board.overview.kafka.needsAttention")}</Status>
                  )
                }
              />
              {/* Three counters rather than one health badge: they are three
                  different failures with three different fixes, and collapsing
                  them would lose which one is happening. */}
              <div className="grid grid-cols-3 gap-2 px-4 pt-4">
                <MiniStat
                  label={t("board.overview.kafka.underReplicated")}
                  value={reported(underReplicated)}
                  color={underReplicated ? "var(--c-warn-text)" : undefined}
                />
                <MiniStat
                  label={t("board.overview.kafka.offline")}
                  value={reported(offline)}
                  color={offline ? "var(--c-err-text)" : undefined}
                />
                <MiniStat
                  label={t("board.overview.kafka.leaderless")}
                  value={reported(leaderless)}
                  color={leaderless ? "var(--c-err-text)" : undefined}
                />
              </div>
              <p className="px-4 pt-3 pb-4 text-[11px] leading-relaxed text-muted-foreground">
                {t("board.overview.kafka.healthNote")}
              </p>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader title={t("board.overview.kafka.brokers")} />
              <Table inset="card">
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t("board.common.address")}</TableHead>
                    <TableHead>Rack</TableHead>
                    <TableHead>{t("board.common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => (
                    <TableRow key={node.id}>
                      <TableCell>{nodeID(node)}</TableCell>
                      <TableCell className="mono3 text-xs">{node.address}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {rack(node) === "" ? "—" : rack(node)}
                      </TableCell>
                      <TableCell>
                        {isController(node) ? (
                          <Status tone="ok">{t("board.overview.kafka.controller")}</Status>
                        ) : (
                          <Status tone="off">{t("board.overview.kafka.broker")}</Status>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </div>
        </PageBody>
      </BoardState>
    </Page>
  );
}
