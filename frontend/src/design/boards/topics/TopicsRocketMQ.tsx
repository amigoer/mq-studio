import { useCallback, useMemo, useState } from "react";
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
  UNKNOWN_METRIC,
  cluster,
  consumerGroups,
  messageType,
  perm,
  readQueue,
  routes,
  topicName,
  writeQueue,
} from "@/mq/rocketmq/destinations";

const SHEET_TABS = ["board.common.overview", "board.common.queue", "board.topics.rocketmq.route"] as const;

const SORTS = ["backlog", "name", "produce"] as const;
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
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("backlog");

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
      if (sort === "name") return topicName(left).localeCompare(topicName(right));
      if (sort === "produce") return right.rateIn - left.rateIn;
      return right.depth - left.depth;
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
                  <TableHead style={{ textAlign: "right" }}>{t("board.common.backlog")}</TableHead>
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
                      <TableCell
                        className="mono3"
                        style={{
                          textAlign: "right",
                          ...dim,
                          ...(topic.depth > 0 && !internal ? { color: "var(--c-warn-text)" } : {}),
                        }}
                      >
                        {metric(topic.depth)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
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
              tab={tab}
              onTabChange={setTab}
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

function TopicSheet({
  topic,
  tab,
  onTabChange,
  onEdit,
  onDelete,
  onClose,
}: {
  topic: Destination;
  tab: string;
  onTabChange: (tab: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = topicName(topic);

  // Per-queue offsets are one request per topic, so they are fetched when a
  // topic is actually opened rather than for every row in the list.
  const load = useCallback(
    (id: number) => topicApi.getTopicStats(id, name),
    [name],
  );
  const stats = useBrokerData(load, { refreshMs: null });
  const queues = (stats.data?.["queues"] as QueueRow[] | undefined) ?? [];
  const route = routes(topic);

  return (
    <DetailPanel onDismiss={onClose}>
      <DetailPanelHeader
        title={name}
        badge={<ProtoBadge protocol="rocketmq" label="RMQ" />}
        tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
        activeTab={tab}
        onTabChange={onTabChange}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.common.produceTps")} value={metric(topic.rateIn)} />
          <MiniStat
            label={t("board.common.backlog")}
            value={metric(topic.depth)}
            color={topic.depth > 0 ? "var(--c-warn-text)" : undefined}
          />
        </div>

        <KV
          rows={[
            [t("board.topics.rocketmq.perm"), perm(topic)],
            [t("board.topics.rocketmq.messageType"), messageType(topic)],
            [t("board.common.queue"), `${metric(readQueue(topic))} / ${metric(writeQueue(topic))}`],
          ]}
        />

        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rocketmq.queueSpread")}</SectionLabel>
          <Card className="gap-0 overflow-hidden rounded-lg py-0">
            {isBlocked(stats) ? (
              <BoardState state={stats} />
            ) : queues.length === 0 ? (
              <Notice title={t("board.topics.rocketmq.noQueues")} />
            ) : (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Broker</TableHead>
                    <TableHead style={{ textAlign: "right" }}>{t("board.common.queue")}</TableHead>
                    <TableHead style={{ textAlign: "right" }}>{t("board.topics.rocketmq.maxOffset")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queues.map((queue) => (
                    <TableRow key={`${queue.brokerName}-${queue.queueId}`}>
                      <TableCell className="mono3">{queue.brokerName}</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        q{queue.queueId}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {queue.maxOffset.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        {route.length > 0 && (
          <div>
            <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rocketmq.route")}</SectionLabel>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {route.map((one) => (
                <Status key={one.brokerAddr || one.broker} tone="ok">
                  {one.broker} · {one.readQueue}/{one.writeQueue} · {one.perm}
                </Status>
              ))}
            </div>
          </div>
        )}
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
