import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelFooter,
  DetailPanelHeader,
  KV,
  Panel,
  ProtoBadge,
  SectionLabel,
  Status,
  useConfirm,
  useToast,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useKafkaTopicDetail, useKafkaTopics } from "@/hooks/kafka/useKafkaTopics";
import {
  deleteKafkaTopic,
  electKafkaPreferredLeaders,
  truncateKafkaTopic,
} from "@/api/kafka";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import {
  cleanupPolicy,
  hasLeader,
  isInternal,
  minInsyncReplicas,
  readableRecords,
  replicationFactor,
  topicIsHealthy,
  underReplicatedPartitions,
} from "@/mq/kafka/destinations";
import { TopicDialogKafka } from "./TopicDialogKafka";
import { ReassignDialogKafka } from "./ReassignDialogKafka";
import { useKafkaCluster } from "@/hooks/kafka/useKafkaCluster";
import { nodeID } from "@/mq/kafka/cluster";

const R = { textAlign: "right" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** A count the cluster did not report, drawn as absent rather than as zero. */
function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

const TAB_PARTITIONS = "board.common.partition";
const TAB_CONFIG = "board.common.config";
const SHEET_TABS = [TAB_PARTITIONS, TAB_CONFIG] as const;

/**
 * Board 4c — Kafka topics.
 *
 * Two columns the canvas drew are gone. The produce rate goes because Kafka's
 * admin protocol reports no rate at all. The backlog goes because a topic does
 * not have one: a backlog belongs to a consumer group reading a topic, so a
 * topic read by five groups has five of them and none of them belongs here.
 *
 * What takes their place is what a topic does have and the canvas left out:
 * how many records are readable in it right now, and its replication settings.
 * "Readable now" rather than "ever written" is the honest figure - retention
 * and compaction move the start offset forward, so the number falls as well as
 * rises, and that is the point.
 */
export function TopicsKafka() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const toast = useToast();

  const [showInternal, setShowInternal] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(TAB_PARTITIONS);
  const [creating, setCreating] = useState(false);
  const [reassigning, setReassigning] = useState<number | null>(null);

  const state = useKafkaTopics();
  const detail = useKafkaTopicDetail(selected);
  const cluster = useKafkaCluster();

  const clusterBrokers = useMemo(
    () =>
      (cluster.data?.nodes ?? [])
        .map((node) => Number.parseInt(nodeID(node), 10))
        .filter((id) => !Number.isNaN(id))
        .sort((left, right) => left - right),
    [cluster.data],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.data ?? [])
      .filter((topic) => showInternal || !isInternal(topic))
      .filter((topic) => term === "" || topic.ref.name.toLowerCase().includes(term))
      .sort((left, right) => left.ref.name.localeCompare(right.ref.name));
  }, [state.data, search, showInternal]);

  const remove = async (name: string) => {
    const ok = await confirm({
      title: t("board.topics.kafka.deleteTitle", { name }),
      description: t("board.topics.kafka.deleteBody"),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteKafkaTopic(connID, name);
      setSelected(null);
      await state.refresh();
      toast.success(t("board.topics.kafka.deleted", { name }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  /*
   * Emptying a topic is DeleteRecords, not a delete: the start offset moves
   * forward to the end and the offsets keep counting, so a consumer sitting at
   * 900 stays at 900 and is simply caught up. That is worth saying in the
   * confirmation, because "empty the topic" sounds like it resets the log.
   */
  const truncate = async (name: string) => {
    const ok = await confirm({
      title: t("board.topics.kafka.truncateTitle", { name }),
      description: t("board.topics.kafka.truncateBody"),
      confirmLabel: t("board.topics.kafka.truncate"),
      danger: true,
    });
    if (!ok) return;
    try {
      await truncateKafkaTopic(connID, name);
      await Promise.all([state.refresh(), detail.refresh()]);
      toast.success(t("board.topics.kafka.truncated", { name }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  const rebalance = async () => {
    const ok = await confirm({
      title: t("board.topics.kafka.rebalanceTitle"),
      description: t("board.topics.kafka.rebalanceBody"),
      confirmLabel: t("board.topics.kafka.rebalance"),
    });
    if (!ok) return;
    try {
      await electKafkaPreferredLeaders(connID);
      await Promise.all([state.refresh(), detail.refresh()]);
      toast.success(t("board.topics.kafka.rebalanced"));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  const partitions = detail.data?.partitions ?? [];
  const configs = detail.data?.configs ?? {};
  const current = partitions.find((row) => row.partition === reassigning) ?? null;

  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle={t("board.topics.kafka.subtitle")}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button variant="outline" onClick={() => void rebalance()}>
              {t("board.topics.kafka.rebalance")}
            </Button>
            <Button onClick={() => setCreating(true)}>{t("board.common.newTopic")}</Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-[240px] flex-none"
          placeholder={t("board.common.searchTopic")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={showInternal} onCheckedChange={setShowInternal} />
          {t("board.topics.kafka.showInternal")}
        </span>
        <span className="flex-1" />
      </Toolbar>

      <BoardState state={state} empty={rows.length === 0 ? <Empty /> : undefined}>
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead style={R}>{t("board.common.partition")}</TableHead>
                  <TableHead style={R}>{t("board.topics.kafka.replicas")}</TableHead>
                  <TableHead style={R}>{t("board.topics.kafka.minIsr")}</TableHead>
                  <TableHead style={R}>{t("board.topics.kafka.records")}</TableHead>
                  <TableHead>{t("board.topics.kafka.cleanup")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((topic) => (
                  <TableRow
                    key={topic.ref.name}
                    selected={selected === topic.ref.name}
                    onClick={() => setSelected(topic.ref.name)}
                  >
                    <TableCell>
                      <b style={{ fontWeight: 500 }}>{topic.ref.name}</b>{" "}
                      {isInternal(topic) && (
                        <Status tone="off" style={{ fontSize: "10px" }}>
                          {t("board.topics.kafka.internal")}
                        </Status>
                      )}
                      {!topicIsHealthy(topic) && (
                        <Status tone="warn" style={{ fontSize: "10px" }}>
                          URP {underReplicatedPartitions(topic)}
                        </Status>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={R}>{topic.partitions}</TableCell>
                    <TableCell className="mono3" style={R}>
                      {reported(replicationFactor(topic))}
                    </TableCell>
                    <TableCell className="mono3" style={R}>
                      {reported(minInsyncReplicas(topic))}
                    </TableCell>
                    <TableCell className="mono3" style={R}>
                      {reported(readableRecords(topic))}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {cleanupPolicy(topic) === "" ? "—" : cleanupPolicy(topic)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPane>

          {selected != null && (
            <DetailPanel width={430} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={selected}
                badge={<ProtoBadge protocol="kafka" />}
                tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
                activeTab={tab}
                onTabChange={setTab}
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody style={{ gap: "10px" }}>
                <BoardState state={detail}>
                  {tab === TAB_PARTITIONS ? (
                    <Panel style={{ overflow: "hidden" }}>
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead style={R}>P</TableHead>
                            <TableHead style={R}>Leader</TableHead>
                            <TableHead>ISR</TableHead>
                            <TableHead style={R}>{t("board.topics.kafka.startOffset")}</TableHead>
                            <TableHead style={R}>{t("board.topics.kafka.endOffset")}</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {partitions.map((partition) => (
                            <TableRow
                              key={partition.partition}
                              style={
                                partition.underReplicated
                                  ? { background: "var(--c-warn-bg-soft)" }
                                  : undefined
                              }
                            >
                              <TableCell className="mono3" style={R}>
                                {partition.partition}
                              </TableCell>
                              <TableCell className="mono3" style={R}>
                                {/* -1 is Kafka's "no leader", and this
                                    partition is neither readable nor writable
                                    while that is true. It must not render as
                                    broker 0, which is a real broker. */}
                                {hasLeader(partition) ? (
                                  partition.leader
                                ) : (
                                  <span style={{ color: "var(--c-err-text)" }}>
                                    {t("board.topics.kafka.noLeader")}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell
                                className="mono3"
                                style={
                                  partition.underReplicated
                                    ? { color: "var(--c-warn-text)" }
                                    : undefined
                                }
                              >
                                {partition.isr.join(",")}
                                {partition.underReplicated && (
                                  <span style={{ fontSize: "9.5px" }}>
                                    {" "}
                                    / {partition.replicas.join(",")}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="mono3" style={R}>
                                {partition.startOffset}
                              </TableCell>
                              <TableCell className="mono3" style={R}>
                                {partition.endOffset}
                              </TableCell>
                              <TableCell style={R}>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => setReassigning(partition.partition)}
                                >
                                  {t("board.topics.kafka.move")}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Panel>
                  ) : (
                    <>
                      <SectionLabel>{t("board.topics.kafka.settings")}</SectionLabel>
                      <KV
                        rows={Object.keys(configs)
                          .sort()
                          .map((key) => [key, configs[key]] as const)}
                      />
                      <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                        {t("board.topics.kafka.settingsNote")}
                      </span>
                    </>
                  )}
                </BoardState>
              </DetailPanelBody>
              <DetailPanelFooter>
                <Button variant="outline" onClick={() => void truncate(selected)}>
                  {t("board.topics.kafka.truncate")}
                </Button>
                <span className="flex-1" />
                <Button variant="destructive" onClick={() => void remove(selected)}>
                  {t("board.common.delete")}
                </Button>
              </DetailPanelFooter>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>

      <TopicDialogKafka
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => void state.refresh()}
      />

      {selected != null && current != null && (
        <ReassignDialogKafka
          open={reassigning != null}
          topic={selected}
          partition={current.partition}
          replicas={current.replicas}
          clusterBrokers={clusterBrokers}
          onClose={() => setReassigning(null)}
          onReassigned={() => void detail.refresh()}
        />
      )}
    </Page>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <div style={{ padding: "24px", fontSize: "12px", color: "var(--c-muted)" }}>
      {t("board.topics.kafka.empty")}
    </div>
  );
}
