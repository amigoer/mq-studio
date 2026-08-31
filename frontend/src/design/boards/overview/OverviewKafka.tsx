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
import { KV, Panel, PanelHeader, StatTile, Status } from "@/components";
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
import { KPI_GRID, TABLE_CARD } from "./_shared";

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
              value={reported(nodes.length === 0 ? null : nodes.length)}
              hint={
                overview != null && controllerNode(overview) !== ""
                  ? t("board.overview.kafka.controllerIs", { id: controllerNode(overview) })
                  : t("board.overview.kafka.noController")
              }
            />
            <StatTile
              label="Topic"
              value={reported(overview ? topicCount(overview) : null)}
              hint={
                internal == null
                  ? ""
                  : t("board.overview.kafka.internalHidden", { count: internal })
              }
            />
            <StatTile
              label={t("board.common.partition")}
              value={reported(overview ? partitionCount(overview) : null)}
              hint={t("board.overview.kafka.acrossAllTopics")}
            />
            <StatTile
              label={t("board.common.consumerGroup")}
              value={reported(overview ? consumerGroupCount(overview) : null)}
              hint={t("board.overview.kafka.groupsHint")}
            />
            <StatTile
              label={t("board.overview.kafka.underReplicated")}
              value={reported(underReplicated)}
              valueColor={underReplicated ? "var(--c-warn-text)" : undefined}
              hint={t("board.overview.kafka.underReplicatedHint")}
            />
          </div>

          <Panel style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
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
            <KV
              rows={[
                [t("board.overview.kafka.underReplicated"), reported(underReplicated)],
                [t("board.overview.kafka.offline"), reported(offline)],
                [t("board.overview.kafka.leaderless"), reported(leaderless)],
              ]}
            />
            <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {t("board.overview.kafka.healthNote")}
            </span>
          </Panel>

          <Panel style={TABLE_CARD}>
            <PanelHeader title={t("board.overview.kafka.brokers")} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ textAlign: "right" }}>ID</TableHead>
                  <TableHead>{t("board.common.address")}</TableHead>
                  <TableHead>Rack</TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {nodeID(node)}
                    </TableCell>
                    <TableCell className="mono3" style={{ fontSize: "11px" }}>
                      {node.address}
                    </TableCell>
                    <TableCell className="mono3" style={{ fontSize: "11px", color: "var(--c-mono-dim)" }}>
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
        </PageBody>
      </BoardState>
    </Page>
  );
}
