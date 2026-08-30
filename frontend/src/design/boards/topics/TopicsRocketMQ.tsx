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
  Segmented,
  SelectField,
  Status,
  type StatusTone,
  useConfirm,
  useToast,
} from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useSettings } from "@/hooks/useSettings";
import { useConnectionScope } from "@/mq/ConnectionScope";
import type { BoardProps } from "@/design/registry";
import { TopicDialog, type TopicForm } from "./TopicDialog";
import * as topicApi from "@/api/topic";
import type { Destination } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";
import { formatMessageTime } from "@/lib/time";
import {
  TopicKind,
  TopicPerm,
  UNKNOWN_METRIC,
  cluster,
  consumerGroups,
  description,
  messageType,
  perm,
  readQueue,
  routes,
  subscribers,
  topicKind,
  topicName,
  writeQueue,
  type TopicRouteItem,
} from "@/mq/rocketmq/destinations";

const SORTS = ["name", "produce"] as const;
type Sort = (typeof SORTS)[number];

/**
 * "普通" covers every business topic, ordered and delayed included, so the
 * segment counts always add up to the "全部" total.
 */
const KIND_FILTERS = ["all", "normal", "retry", "dlq"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

function matchesKind(kind: TopicKind, filter: KindFilter): boolean {
  if (filter === "all") return true;
  if (filter === "normal")
    return kind === TopicKind.Normal || kind === TopicKind.FIFO || kind === TopicKind.Delay;
  return kind === filter;
}

function metric(value: number): string {
  return value === UNKNOWN_METRIC ? "—" : value.toLocaleString();
}

const PERM_TONE: Record<string, StatusTone> = {
  [TopicPerm.ReadWrite]: "ok",
  [TopicPerm.ReadOnly]: "warn",
  [TopicPerm.WriteOnly]: "warn",
  [TopicPerm.Deny]: "err",
};

/** Retry and dead-letter rows are the broker's own bookkeeping, drawn dimmed. */
function isDerived(kind: TopicKind): boolean {
  return kind === TopicKind.Retry || kind === TopicKind.DLQ;
}

/**
 * Board 3c — RocketMQ topics. The detail panel is a floating sheet rather than
 * a third column, so opening it never reflows the table's column widths.
 *
 * The canvas's "今日消息量" column is gone: the brokers report a per-topic
 * message count for today nowhere, only per broker, and a topic-level figure
 * would have to be invented. Created-at went the same way.
 */
export function TopicsRocketMQ({ nav }: BoardProps = {}) {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();
  const confirm = useConfirm();
  // Arriving from another page may ask for the create form; a later render
  // must not reopen it, so the request is read once.
  const [dialog, setDialog] = useState<{ editing: string | null } | null>(() =>
    nav?.focus?.create === true ? { editing: null } : null,
  );
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(nav?.focus?.topic ?? null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  // The name server hands topics back in no useful order, so name is the
  // default rather than whatever the broker's own set iterates as.
  const [sort, setSort] = useState<Sort>("name");

  const load = useCallback(
    (id: number) => (showSystem ? topicApi.getAllTopics(id) : topicApi.getTopics(id)),
    [showSystem],
  );
  const state = useBrokerData(load);
  const topics = state.data ?? [];

  const kinds = useMemo(() => {
    const byName = new Map<string, TopicKind>();
    for (const topic of topics) byName.set(topicName(topic), topicKind(topic));
    return byName;
  }, [topics]);

  const counts = useMemo(() => {
    const tally: Record<KindFilter, number> = { all: 0, normal: 0, retry: 0, dlq: 0 };
    for (const value of kinds.values()) {
      tally.all++;
      if (value === TopicKind.Retry) tally.retry++;
      else if (value === TopicKind.DLQ) tally.dlq++;
      else tally.normal++;
    }
    return tally;
  }, [kinds]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = topics.filter((topic) => {
      if (!matchesKind(kinds.get(topicName(topic)) ?? TopicKind.Normal, kind)) return false;
      if (needle === "") return true;
      return (
        topicName(topic).toLowerCase().includes(needle) ||
        description(topic).toLowerCase().includes(needle)
      );
    });
    return [...matched].sort((left, right) => {
      if (sort === "produce") return right.rateIn - left.rateIn;
      return topicName(left).localeCompare(topicName(right));
    });
  }, [kind, kinds, query, sort, topics]);

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
        <Segmented
          options={KIND_FILTERS.map((key) => ({
            value: key,
            label: `${t(`board.topics.rocketmq.kind.${key}`)} ${counts[key]}`,
          }))}
          value={kind}
          onChange={setKind}
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
                  <TableHead>{t("board.topics.rocketmq.type")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.topics.rocketmq.queueRW")}</TableHead>
                  <TableHead>{t("board.topics.rocketmq.perm")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.produceTps")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.consumerGroup")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((topic) => {
                  const name = topicName(topic);
                  const rowKind = kinds.get(name) ?? TopicKind.Normal;
                  const derived = isDerived(rowKind);
                  const dim = derived ? { color: "var(--c-muted)" } : undefined;
                  return (
                    <TableRow key={name} selected={selected === name} onClick={() => setSelected(name)}>
                      <TableCell style={dim}>
                        {derived ? name : <b style={{ fontWeight: 500 }}>{name}</b>}
                      </TableCell>
                      <TableCell style={dim}>
                        {t(`board.topics.rocketmq.kindOf.${rowKind}`)}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(readQueue(topic))} / {metric(writeQueue(topic))}
                      </TableCell>
                      <TableCell>
                        <Status tone={PERM_TONE[perm(topic)] ?? "off"}>{perm(topic)}</Status>
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
                    <TableCell colSpan={6} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
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
              onBrowse={() => nav?.onOpenPage?.("messages", { topic: topicName(current) })}
              onSend={() => nav?.onOpenPage?.("producer", { topic: topicName(current) })}
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
  onBrowse,
  onSend,
  onClose,
}: {
  topic: Destination;
  onEdit: () => void;
  onDelete: () => void;
  onBrowse: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const name = topicName(topic);

  /*
   * Two requests, both paid on open rather than for every row in the list: the
   * route table and the outbound rate cost one call per consumer group, and
   * the per-queue offsets one call per topic.
   */
  const detail = useBrokerData(
    useCallback((id: number) => topicApi.getTopicDetail(id, name), [name]),
    { refreshMs: null },
  );
  const stats = useBrokerData(
    useCallback((id: number) => topicApi.getTopicStats(id, name), [name]),
    { refreshMs: null },
  );

  // The list row is what draws until the lookup lands, so the panel opens
  // with figures rather than a column of dashes.
  const full = detail.data ?? topic;
  const queues = (stats.data?.["queues"] as QueueRow[] | undefined) ?? [];
  const stored = stats.data?.["totalMessages"] as number | undefined;
  const blocks = brokerBlocks(routes(full), queues);
  const groups = subscribers(full);
  const updated = formatMessageTime(
    full.lastUpdated,
    settings.timezone,
    settings.timestampFormat,
  );

  return (
    <DetailPanel width={420} onDismiss={onClose}>
      <DetailPanelHeader
        title={name}
        badge={<ProtoBadge protocol="rocketmq" label="RMQ" />}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.common.produceTps")} value={metric(full.rateIn)} />
          <MiniStat
            label={t("board.common.consumeTps")}
            value={detail.loading ? "…" : metric(full.rateOut)}
          />
        </div>

        <KV
          rows={[
            [t("board.topics.rocketmq.perm"), perm(full)],
            [t("board.topics.rocketmq.messageType"), messageType(full)],
            [
              t("board.topics.rocketmq.queueRW"),
              `${metric(readQueue(full))} / ${metric(writeQueue(full))}`,
            ],
            [t("board.common.consumerGroup"), metric(consumerGroups(full))],
            [t("board.common.cluster"), cluster(full) || "—"],
            [t("board.topics.rocketmq.lastUpdated"), updated],
            ...(description(full) === ""
              ? []
              : [[t("board.topics.rocketmq.description"), description(full)] as const]),
          ]}
        />

        <div>
          <SectionLabel
            className="mb-1.5"
            actionColor="inherit"
            action={detail.loading ? <Spinner className="size-3" /> : null}
          >
            {t("board.topics.rocketmq.subscribers")}
          </SectionLabel>
          {groups.length === 0 ? (
            <Notice
              title={t(
                detail.loading
                  ? "board.state.loading"
                  : "board.topics.rocketmq.noSubscribers",
              )}
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => (
                <span
                  key={group}
                  className="mono3 rounded-md border px-2 py-0.5 text-[11px] text-(--c-mono-dim)"
                >
                  {group}
                </span>
              ))}
            </div>
          )}
        </div>

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
        <Button variant="outline" onClick={onBrowse}>
          {t("board.topics.rocketmq.browse")}
        </Button>
        <Button variant="outline" onClick={onSend}>
          {t("board.common.sendMessage")}
        </Button>
        <Button variant="outline" onClick={onEdit}>{t("board.common.edit")}</Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDelete}>
          {t("board.common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
