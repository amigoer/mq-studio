import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  MiniStat,
  ProtoBadge,
  SectionLabel,
  SelectField,
  Status,
  type StatusTone,
  useConfirm,
  useToast,
} from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { TopicDialog, type TopicForm } from "./TopicDialog";
import * as topicApi from "@/api/topic";
import type { Destination } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";
import {
  TopicPerm,
  UNKNOWN_METRIC,
  cluster,
  consumerGroups,
  messageType,
  perm,
  readQueue,
  routes,
  topicName,
  writeQueue,
  type TopicRouteItem,
} from "@/mq/rocketmq/destinations";

const SORTS = ["name", "produce"] as const;
type Sort = (typeof SORTS)[number];

function metric(value: number): string {
  return value === UNKNOWN_METRIC ? "—" : value.toLocaleString();
}

/** RocketMQ's own internal topics, which the toggle hides by default. */
function isInternal(name: string): boolean {
  return name.startsWith("%RETRY%") || name.startsWith("%DLQ%");
}

/**
 * Board 3c — RocketMQ topics. The detail panel is a floating sheet rather than
 * a third column, so opening it never reflows the table's column widths.
 *
 * The canvas's "今日消息量" column is gone: the brokers report a per-topic
 * message count for today nowhere, only per broker, and a topic-level figure
 * would have to be invented. Created-at went the same way.
 */
export function TopicsRocketMQ() {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<{ editing: string | null } | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The name server hands topics back in no useful order, so name is the
  // default rather than whatever the broker's own set iterates as.
  const [sort, setSort] = useState<Sort>("name");

  const load = useCallback(
    (id: number) => (showSystem ? topicApi.getAllTopics(id) : topicApi.getTopics(id)),
    [showSystem],
  );
  const state = useBrokerData(load);
  const topics = state.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = topics.filter((topic) =>
      needle === "" ? true : topicName(topic).toLowerCase().includes(needle),
    );
    return [...matched].sort((left, right) => {
      if (sort === "produce") return right.rateIn - left.rateIn;
      return topicName(left).localeCompare(topicName(right));
    });
  }, [query, sort, topics]);

  const current = rows.find((topic) => topicName(topic) === selected);
  const editing =
    dialog?.editing != null ? topics.find((topic) => topicName(topic) === dialog.editing) : undefined;

  const submit = async (form: TopicForm) => {
    if (dialog?.editing != null) {
      await topicApi.updateTopic(
        connID, form.topic, form.brokerAddr, form.readQueue, form.writeQueue, form.perm,
      );
    } else {
      await topicApi.createTopic(
        connID, form.topic, form.brokerAddr, form.readQueue, form.writeQueue, form.perm,
      );
    }
    toast.success(t("board.topics.rocketmq.saved", { name: form.topic }));
    await state.refresh();
  };

  const remove = async (topic: Destination) => {
    const name = topicName(topic);
    const confirmed = await confirm({
      title: t("board.topics.rocketmq.deleteTitle"),
      description: t("board.topics.rocketmq.deleteDesc", { name }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await topicApi.deleteTopic(connID, name, cluster(topic));
      toast.success(t("board.topics.rocketmq.deleted", { name }));
      setSelected(null);
      await state.refresh();
    } catch (failure) {
      toast.error(t("board.topics.rocketmq.deleteFailed"), {
        description: formatErrorMessage(failure),
      });
    }
  };

  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle={t("board.topics.rocketmq.liveSubtitle", { count: topics.length })}
        actions={
          <>
            <Button variant="outline" disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
              {state.refreshing && <Spinner />}
              {t("board.common.refresh")}
            </Button>
            <Button disabled={!online} onClick={() => setDialog({ editing: null })}>
              {t("board.common.newTopic")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          placeholder={t("board.common.searchTopic")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-(--c-mono-dim)">
          <Switch checked={showSystem} onCheckedChange={setShowSystem} />
          {t("board.topics.rocketmq.showSystem")}
        </label>
        <span className="flex-1" />
        <SelectField
          value={sort}
          onValueChange={setSort}
          options={SORTS.map((key) => ({
            value: key,
            label: t(`board.topics.rocketmq.sort.${key}`),
          }))}
        />
      </Toolbar>

      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.topics.rocketmq.queueRW")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.produceTps")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.consumerGroup")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((topic) => {
                  const name = topicName(topic);
                  const internal = isInternal(name);
                  const dim = internal ? { color: "var(--c-muted)" } : undefined;
                  return (
                    <TableRow key={name} selected={selected === name} onClick={() => setSelected(name)}>
                      <TableCell style={dim}>
                        {internal ? name : <b style={{ fontWeight: 500 }}>{name}</b>}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(readQueue(topic))} / {metric(writeQueue(topic))}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(topic.rateIn)}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(consumerGroups(topic))}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t(topics.length === 0 ? "board.topics.rocketmq.noTopics" : "board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <TopicSheet
              key={topicName(current)}
              topic={current}
              onEdit={() => setDialog({ editing: topicName(current) })}
              onDelete={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}

      <TopicDialog
        open={dialog != null}
        editing={editing}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />
    </Page>
  );
}

interface QueueRow {
  brokerName: string;
  queueId: number;
  minOffset: number;
  maxOffset: number;
  messages: number;
}

/** One broker: its route configuration, and the queues sitting on it. */
interface BrokerBlock {
  broker: string;
  addr: string;
  perm: TopicPerm | "";
  readQueue: number;
  writeQueue: number;
  queues: QueueRow[];
}

const PERM_TONE: Record<string, StatusTone> = {
  [TopicPerm.ReadWrite]: "ok",
  [TopicPerm.ReadOnly]: "warn",
  [TopicPerm.WriteOnly]: "warn",
  [TopicPerm.Deny]: "err",
};

/*
 * The route table and the per-queue offsets are both keyed by broker, so they
 * are shown grouped rather than as two lists repeating the same broker names.
 * A queue on a broker the route does not mention still gets a group, so a
 * stale route cannot hide a queue that exists.
 */
function brokerBlocks(route: TopicRouteItem[], queues: QueueRow[]): BrokerBlock[] {
  const blocks = new Map<string, BrokerBlock>();
  for (const item of route) {
    blocks.set(item.broker, {
      broker: item.broker,
      addr: item.brokerAddr,
      perm: item.perm,
      readQueue: item.readQueue,
      writeQueue: item.writeQueue,
      queues: [],
    });
  }
  for (const queue of queues) {
    let block = blocks.get(queue.brokerName);
    if (block == null) {
      block = {
        broker: queue.brokerName,
        addr: "",
        perm: "",
        readQueue: UNKNOWN_METRIC,
        writeQueue: UNKNOWN_METRIC,
        queues: [],
      };
      blocks.set(queue.brokerName, block);
    }
    block.queues.push(queue);
  }
  return [...blocks.values()];
}

/**
 * The topic inspector: one scrolling column, no tabs.
 *
 * The overview / queues / routing tabs held about a dozen facts between them
 * and showed a third of them at a time, in a panel with room for all of it.
 *
 * Backlog is not among those facts: RocketMQ reports no per-topic depth, only
 * per-consumer-group, so the tile could never have read anything but a dash.
 */
function TopicSheet({
  topic,
  onEdit,
  onDelete,
  onClose,
}: {
  topic: Destination;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = topicName(topic);

  // Per-queue offsets are one request per topic, now paid on open: the panel
  // shows them without a tab to hide behind.
  const load = useCallback(
    (id: number) => topicApi.getTopicStats(id, name),
    [name],
  );
  const stats = useBrokerData(load, { refreshMs: null });
  const queues = (stats.data?.["queues"] as QueueRow[] | undefined) ?? [];
  const stored = stats.data?.["totalMessages"] as number | undefined;
  const blocks = brokerBlocks(routes(topic), queues);

  return (
    <DetailPanel width={420} onDismiss={onClose}>
      <DetailPanelHeader
        title={name}
        badge={<ProtoBadge protocol="rocketmq" label="RMQ" />}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.common.produceTps")} value={metric(topic.rateIn)} />
          <MiniStat label={t("board.common.consumeTps")} value={metric(topic.rateOut)} />
        </div>

        <KV
          rows={[
            [t("board.topics.rocketmq.perm"), perm(topic)],
            [t("board.topics.rocketmq.messageType"), messageType(topic)],
            [
              t("board.topics.rocketmq.queueRW"),
              `${metric(readQueue(topic))} / ${metric(writeQueue(topic))}`,
            ],
            [t("board.common.consumerGroup"), metric(consumerGroups(topic))],
            [t("board.common.cluster"), cluster(topic) || "—"],
          ]}
        />

        <div>
          <SectionLabel
            className="mb-1.5"
            actionColor="inherit"
            action={
              stats.loading ? (
                <Spinner className="size-3" />
              ) : stored == null ? null : (
                t("board.topics.rocketmq.storedN", { n: stored.toLocaleString() })
              )
            }
          >
            {t("board.topics.rocketmq.brokerQueues")}
          </SectionLabel>

          {blocks.length === 0 ? (
            <Notice title={t("board.topics.rocketmq.noRoute")} />
          ) : (
            <Card className="gap-0 overflow-hidden rounded-lg py-0">
              <Table className="text-xs [&_td]:px-2.5 [&_th]:px-2.5">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.common.queue")}</TableHead>
                    <TableHead style={{ textAlign: "right" }}>{t("board.common.offset")}</TableHead>
                    <TableHead style={{ textAlign: "right" }}>
                      {t("board.topics.rocketmq.messageCount")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocks.map((block) => (
                    <Fragment key={block.broker}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={3} className="py-1.5">
                          <span className="flex items-center gap-1.5">
                            <b className="mono3 font-medium">{block.broker}</b>
                            {block.perm !== "" && (
                              <Status tone={PERM_TONE[block.perm] ?? "off"}>{block.perm}</Status>
                            )}
                            <span className="flex-1" />
                            <span className="mono3 text-(--c-mono-dim)">
                              {metric(block.readQueue)} / {metric(block.writeQueue)}
                            </span>
                          </span>
                          {block.addr !== "" && (
                            <span className="mono3 mt-0.5 block text-[10.5px] text-(--c-muted)">
                              {block.addr}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                      {block.queues.map((queue) => (
                        <TableRow key={queue.queueId}>
                          <TableCell className="mono3" style={{ paddingLeft: "20px" }}>
                            q{queue.queueId}
                          </TableCell>
                          <TableCell className="mono3" style={{ textAlign: "right" }}>
                            {queue.minOffset.toLocaleString()} – {queue.maxOffset.toLocaleString()}
                          </TableCell>
                          <TableCell className="mono3" style={{ textAlign: "right" }}>
                            {queue.messages.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                      {block.queues.length === 0 && stats.data != null && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            style={{ textAlign: "center", color: "var(--c-muted)" }}
                          >
                            {t("board.topics.rocketmq.noQueues")}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {stats.error != null && <BoardState state={stats} />}
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onEdit}>{t("board.common.edit")}</Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDelete}>
          {t("board.common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
